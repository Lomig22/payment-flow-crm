import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { supabase } from '@/lib/supabase';
import { withEndCard } from '@/lib/endCard';
import { fixEscapedEmoji } from '@/lib/utils';
import { getAccountToken, igGet } from '@/lib/instagramGraph';
import { postYouTube, youtubeCanUploadNow, youtubeQuotaLeft, markYouTubeQuotaExhausted, endOfPacificDay } from '@/lib/crosspost';

// Rattrapage YouTube des reels déjà publiés sur Instagram (avant la connexion YouTube) :
// un reel par passage du cron, du plus récent au plus ancien, avec le quota restant du
// jour, après les cross-posts des nouveaux reels. La vidéo vient de l'API Instagram ;
// les reels avec une musique de la bibliothèque Instagram n'ont pas de vidéo fournie : ignorés.

const MAX_ATTEMPTS = 3;

export async function youtubeBackfillOne(): Promise<{ id: string; status: string } | null> {
  const db = supabase as any;
  const { data: yt } = await db.from('platform_tokens').select('data').eq('platform', 'youtube').maybeSingle();
  if (!yt?.data || yt.data.enabled === false || yt.data.backfill === false) return null;
  if (!(await youtubeCanUploadNow())) return null;

  // Les nouveaux reels d'abord : pas de rattrapage tant qu'un cross-post YouTube attend
  const { count: pendingNew } = await db.from('content_queue')
    .select('id', { count: 'exact', head: true }).eq('status', 'published').eq('crosspost->youtube->>status', 'pending');
  if (pendingNew) return null;
  // … et une place réservée pour chaque reel encore programmé avant la fin du jour YouTube
  const { count: upcoming } = await db.from('content_queue')
    .select('id', { count: 'exact', head: true }).eq('format', 'reel').in('status', ['scheduled', 'publishing'])
    .lt('scheduled_at', endOfPacificDay().toISOString());
  if ((await youtubeQuotaLeft()) <= (upcoming ?? 0)) return null;

  // Reels publiés par le CRM après la connexion YouTube : déjà gérés par le cross-post
  const { data: handled } = await db.from('content_queue').select('ig_media_id').not('crosspost->youtube', 'is', null).not('ig_media_id', 'is', null);
  const skipIds = new Set((handled ?? []).map((r: any) => r.ig_media_id));

  const { data: candidates } = await db.from('ig_content')
    .select('id, ig_media_id, account_username, caption, youtube')
    .eq('format', 'reel')
    .or('youtube.is.null,youtube->>status.eq.pending')
    .order('published_at', { ascending: false })
    .limit(20);
  const reel = (candidates ?? []).find((c: any) => !skipIds.has(c.ig_media_id));
  if (!reel) return null;

  const attempts = (reel.youtube?.attempts ?? 0) + 1;
  const save = (youtube: Record<string, unknown>) => db.from('ig_content').update({ youtube }).eq('id', reel.id);
  if (attempts > MAX_ATTEMPTS) { await save({ ...reel.youtube, status: 'failed' }); return { id: reel.id, status: 'failed' }; }
  await save({ ...(reel.youtube ?? {}), status: 'pending', attempts });   // tentative comptée avant l'envoi

  try {
    const tok = await getAccountToken(reel.account_username);
    if (!tok) throw new Error('Compte Instagram non connecté');
    const { media_url } = await igGet<{ media_url?: string }>(reel.ig_media_id, tok.access_token, { fields: 'media_url' });
    if (!media_url) {
      await save({ status: 'skipped', error: 'Vidéo non fournie par Instagram (musique de la bibliothèque Instagram)', at: new Date().toISOString() });
      return { id: reel.id, status: 'skipped' };
    }
    const res = await fetch(media_url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Téléchargement Instagram impossible (${res.status})`);
    // Séquence de fin CTA ajoutée avant l'envoi (si déposée)
    const tmp = path.join(os.tmpdir(), `yt-${reel.id}.mp4`);
    await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
    let video: Buffer;
    try {
      const withCard = await withEndCard(tmp, `yt-${reel.id}`);
      video = await fs.readFile(withCard.path);
      if (withCard.path !== tmp) await fs.rm(withCard.path, { force: true });
    } finally {
      await fs.rm(tmp, { force: true });
    }
    const r = await postYouTube(yt.data, video, fixEscapedEmoji(reel.caption ?? ''));
    await save({ status: 'done', id: r.id, url: r.url, attempts, at: new Date().toISOString(), ...(r.warning ? { warning: r.warning } : {}) });
    return { id: reel.id, status: 'done' };
  } catch (e: any) {
    if (e.quota) {
      await markYouTubeQuotaExhausted();
      await save({ ...(reel.youtube ?? {}), status: 'pending', attempts: attempts - 1, error: 'Quota YouTube du jour atteint' });
      return { id: reel.id, status: 'quota' };
    }
    await save({ status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, error: e.message, at: new Date().toISOString() });
    return { id: reel.id, status: 'error' };
  }
}
