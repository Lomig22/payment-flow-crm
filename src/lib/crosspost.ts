import { supabase } from '@/lib/supabase';
import { postTikTok } from '@/lib/tiktok';
import { fixEscapedEmoji } from '@/lib/utils';

// Cross-post des reels publiés sur Instagram : Page Facebook (Reels), YouTube (Shorts) et TikTok,
// avec la même légende. Lancé par le cron après la publication Instagram ; la vidéo
// reste dans Storage tant qu'un cross-post est en attente, puis elle est supprimée.

const BUCKET   = 'content-media';
const FB_GRAPH = 'https://graph.facebook.com/v23.0';
const MAX_ATTEMPTS = 3;

type Platform = 'facebook' | 'youtube' | 'tiktok';
interface PlatformState { status: 'pending' | 'done' | 'failed'; id?: string; url?: string; error?: string; attempts?: number; at?: string; warning?: string }
type CrossPost = Partial<Record<Platform, PlatformState>>;

async function tokens(): Promise<Partial<Record<Platform, any>>> {
  const { data } = await (supabase as any).from('platform_tokens').select('platform, data');
  return Object.fromEntries((data ?? []).filter((r: any) => r.data?.enabled !== false).map((r: any) => [r.platform, r.data]));
}

// Plateformes à servir pour un reel qui vient d'être publié sur Instagram
// Republication d'un reel : pas de nouvel envoi YouTube (le Short d'origine y est déjà
// ou y arrivera par le rattrapage ; deux fois le même Short = contenu répétitif)
export async function pendingCrossPost(format: string, isRepublish = false): Promise<CrossPost> {
  if (format !== 'reel') return {};
  const t = await tokens();
  const out: CrossPost = {};
  for (const p of Object.keys(t) as Platform[]) {
    if (isRepublish && p === 'youtube') continue;
    out[p] = { status: 'pending', attempts: 0 };
  }
  return out;
}

// ── Facebook : Reels de Page (upload hébergé : Facebook télécharge media_url) ──
async function postFacebook(fb: any, mediaUrl: string, caption: string): Promise<{ id: string; url?: string }> {
  const form = (o: Record<string, string>) => new URLSearchParams({ ...o, access_token: fb.access_token });
  const json = async (res: Response) => {
    const b = await res.json();
    if (!res.ok || b.error) throw new Error(b.error?.error_user_msg ?? b.error?.message ?? `HTTP ${res.status}`);
    return b;
  };
  const start = await json(await fetch(`${FB_GRAPH}/${fb.page_id}/video_reels`, { method: 'POST', body: form({ upload_phase: 'start' }) }));
  await json(await fetch(`https://rupload.facebook.com/video-upload/v23.0/${start.video_id}`, {
    method: 'POST', headers: { Authorization: `OAuth ${fb.access_token}`, file_url: mediaUrl },
  }));
  await json(await fetch(`${FB_GRAPH}/${fb.page_id}/video_reels`, {
    method: 'POST',
    body: form({ upload_phase: 'finish', video_id: start.video_id, video_state: 'PUBLISHED', description: caption }),
  }));
  return { id: start.video_id, url: `https://www.facebook.com/reel/${start.video_id}` };
}

export async function downloadVideo(storagePath: string): Promise<Buffer> {
  const { data: blob, error } = await supabase.storage.from(BUCKET).download(storagePath);
  if (error || !blob) throw new Error(`Vidéo introuvable : ${error?.message ?? storagePath}`);
  return Buffer.from(await blob.arrayBuffer());
}

// ── YouTube : Short via l'API Data v3 (envoi « resumable ») ──
async function youtubeAccessToken(yt: any): Promise<string> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    body: new URLSearchParams({ client_id: yt.client_id, client_secret: yt.client_secret, refresh_token: yt.refresh_token, grant_type: 'refresh_token' }),
  });
  const b = await res.json();
  if (!res.ok) throw new Error(`Google : ${b.error_description ?? b.error ?? res.status}`);
  return b.access_token;
}

export async function postYouTube(yt: any, bytes: Buffer, caption: string): Promise<{ id: string; url: string; warning?: string }> {
  const lines = caption.split('\n').map((l) => l.trim()).filter(Boolean);
  const tags  = (caption.match(/#[A-Za-zÀ-ÿ0-9_]+/g) ?? []).map((t) => t.slice(1));
  // Titre : la catchline (100 caractères max, #shorts inclus)
  const title = `${(lines[0] ?? 'Chantier').replace(/#\S+/g, '').trim().slice(0, 90)} #shorts`;
  const access = await youtubeAccessToken(yt);

  const init = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`, 'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes.length),
    },
    body: JSON.stringify({
      snippet: { title, description: caption, tags, categoryId: '22' },
      status:  { privacyStatus: 'public', selfDeclaredMadeForKids: false },
    }),
  });
  if (!init.ok) {
    const err = (await init.json().catch(() => ({})))?.error;
    const e: any = new Error(`YouTube : ${err?.message ?? init.status}`);
    // Quota du jour épuisé : ce n'est pas un échec, on réessaie demain
    e.quota = (err?.errors ?? []).some((x: any) => /quota|uploadLimit|rateLimit/i.test(x.reason ?? '')) || /quota/i.test(err?.message ?? '');
    throw e;
  }
  const location = init.headers.get('location');
  if (!location) throw new Error('YouTube : URL d\'envoi absente');

  const up = await fetch(location, { method: 'PUT', headers: { 'Content-Type': 'video/mp4' }, body: new Uint8Array(bytes) });
  const b  = await up.json();
  if (!up.ok) throw new Error(`YouTube : ${b.error?.message ?? up.status}`);
  // Projet Google non audité : YouTube force la vidéo en privé
  const warning = b.status?.privacyStatus && b.status.privacyStatus !== 'public'
    ? `Vidéo en « ${b.status.privacyStatus} » : audit YouTube nécessaire pour publier en public automatiquement` : undefined;
  await countYouTubeUpload();
  return { id: b.id, url: `https://youtube.com/shorts/${b.id}`, warning };
}

// ── Rythme YouTube (jour du Pacifique, remise à zéro vers 9 h à Paris) : 10 Shorts par jour
// maximum (choix de Lomig : « 6 à 10 par jour, pas plus »), espacés d'au moins 45 min.
// Un refus de quota de YouTube met aussi fin à la journée.
export const YT_DAILY_LIMIT  = Number(process.env.YT_DAILY_LIMIT || 10);
export const YT_MIN_GAP_MS   = 45 * 60_000;
export const pacificDay = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date());

async function youtubeUsage(): Promise<{ data: any; today: number }> {
  const { data } = await (supabase as any).from('platform_tokens').select('data').eq('platform', 'youtube').maybeSingle();
  const d = data?.data ?? {};
  return { data: d, today: d.quota_day === pacificDay() ? d.uploads_today ?? 0 : 0 };
}
export async function youtubeQuotaLeft(): Promise<number> {
  return Math.max(0, YT_DAILY_LIMIT - (await youtubeUsage()).today);
}
// Fin du jour YouTube en cours (minuit, heure du Pacifique), en instant UTC
export function endOfPacificDay(): Date {
  const now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/Los_Angeles', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - now.getTime();
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1) - offset);
}

// Prochain envoi possible : quota du jour restant ET 45 min depuis le dernier Short
export async function youtubeCanUploadNow(): Promise<boolean> {
  const { data, today } = await youtubeUsage();
  if (today >= YT_DAILY_LIMIT) return false;
  return !data.last_upload_at || Date.now() - new Date(data.last_upload_at).getTime() >= YT_MIN_GAP_MS;
}
async function countYouTubeUpload() {
  const { data, today } = await youtubeUsage();
  await (supabase as any).from('platform_tokens')
    .update({ data: { ...data, quota_day: pacificDay(), uploads_today: today + 1, last_upload_at: new Date().toISOString() } }).eq('platform', 'youtube');
}
export async function markYouTubeQuotaExhausted() {
  const { data } = await youtubeUsage();
  await (supabase as any).from('platform_tokens')
    .update({ data: { ...data, quota_day: pacificDay(), uploads_today: YT_DAILY_LIMIT } }).eq('platform', 'youtube');
}

// Traite les cross-posts en attente (temps borné) ; supprime les fichiers une fois terminé
export async function crossPostDue(budgetMs: number): Promise<{ id: string; platform: Platform; status: string }[]> {
  const deadline = Date.now() + budgetMs;
  const db = supabase as any;
  // Une file par plateforme : des reels qui attendent YouTube (quota de 10 / jour atteint) ne
  // doivent jamais bloquer le cross-post Facebook des reels plus récents (bloqué du 11 au 13/10/2026)
  const pendingOn = (p: Platform, limit: number) => db.from('content_queue')
    .select('id, caption, media_url, storage_path, frame_paths, crosspost')
    .eq('status', 'published').eq(`crosspost->${p}->>status`, 'pending')
    .order('published_at', { ascending: true }).limit(limit);
  const lists = await Promise.all([
    pendingOn('facebook', 10),
    (await youtubeCanUploadNow()) ? pendingOn('youtube', 1) : Promise.resolve({ data: [] }),
    pendingOn('tiktok', 1),
  ]);
  const seen = new Set<string>();
  const rows = lists.flatMap((l: any) => l.data ?? []).filter((r: any) => !seen.has(r.id) && seen.add(r.id));
  const t = await tokens();
  const results: { id: string; platform: Platform; status: string }[] = [];

  let heavyDone = false;   // un seul envoi lourd (YouTube / TikTok) par passage : limite de 60 s
  for (const row of rows) {
    const cp: CrossPost = { ...(row.crosspost ?? {}) };
    for (const p of ['facebook', 'youtube', 'tiktok'] as Platform[]) {
      const st = cp[p];
      const heavy = p !== 'facebook';
      if (st?.status !== 'pending' || Date.now() >= deadline || (heavy && heavyDone)) continue;
      if (p === 'youtube' && !(await youtubeCanUploadNow())) continue;   // rythme : 10/jour, 45 min d'écart
      // Tentative comptée AVANT l'envoi : une exécution coupée en plein envoi ne
      // relance pas indéfiniment (risque de double publication)
      const attempts = (st.attempts ?? 0) + 1;
      if (attempts > MAX_ATTEMPTS) {
        cp[p] = { ...st, status: 'failed', error: st.error ?? 'Envoi interrompu à plusieurs reprises' };
      } else {
        await db.from('content_queue').update({ crosspost: { ...cp, [p]: { ...st, attempts } } }).eq('id', row.id);
        try {
          if (!t[p]) throw new Error('Plateforme non connectée');
          if (!row.media_url || !row.storage_path) throw new Error('Vidéo supprimée avant le cross-post');
          if (heavy) heavyDone = true;
          const caption = fixEscapedEmoji(row.caption ?? '');
          const r = p === 'facebook' ? await postFacebook(t.facebook, row.media_url, caption)
            : p === 'youtube'        ? await postYouTube(t.youtube, await downloadVideo(row.storage_path), caption)
            : await postTikTok(t.tiktok, await downloadVideo(row.storage_path), caption);
          const warning = (r as { warning?: string }).warning;
          cp[p] = { status: 'done', id: r.id, url: r.url, attempts, at: new Date().toISOString(), ...(warning ? { warning } : {}) };
        } catch (e: any) {
          if (e.quota) {
            await markYouTubeQuotaExhausted();
            cp[p] = { ...st, status: 'pending', error: 'Quota YouTube du jour atteint : envoi demain' };
          } else {
            cp[p] = { status: attempts >= MAX_ATTEMPTS ? 'failed' : 'pending', attempts, error: e.message, at: new Date().toISOString() };
          }
        }
      }
      results.push({ id: row.id, platform: p, status: cp[p]!.status });
      await db.from('content_queue').update({ crosspost: cp, updated_at: new Date().toISOString() }).eq('id', row.id);
    }
    // Plus rien en attente : la vidéo et ses images quittent le stockage
    if (!Object.values(cp).some((s) => s?.status === 'pending')) {
      await cleanupPublishedFiles(row.id, row.storage_path, row.frame_paths);
    }
  }
  return results;
}

export async function cleanupPublishedFiles(id: string, storagePath: string | null, framePaths: string[] | null) {
  // Tous les fichiers du reel : vidéo publiée, original nettoyé, base et rendus de la voix off
  const { data: own } = await supabase.storage.from(BUCKET).list('clean', { search: id, limit: 50 });
  const files = Array.from(new Set([
    ...(storagePath ? [storagePath] : []), ...(framePaths ?? []),
    ...(own ?? []).filter((f) => f.name.startsWith(id)).map((f) => `clean/${f.name}`),
  ]));
  if (files.length) await supabase.storage.from(BUCKET).remove(files);
  await (supabase as any).from('content_queue').update({ storage_path: null, frame_paths: null }).eq('id', id);
}

// État réel d'un Reel de Page côté Facebook (traitement, publication, lien), pour vérifier qu'un
// envoi accepté par l'API est bien en ligne
export async function facebookReelStatus(videoId: string): Promise<any> {
  const fb = (await tokens()).facebook;
  if (!fb) throw new Error('Facebook non connecté');
  const res = await fetch(`${FB_GRAPH}/${videoId}?fields=status,published,permalink_url,created_time,description&access_token=${encodeURIComponent(fb.access_token)}`, { cache: 'no-store' });
  return res.json();
}

// Page Facebook connectée au CRM : nom, lien, compte Instagram rattaché
export async function facebookPageInfo(): Promise<any> {
  const fb = (await tokens()).facebook;
  if (!fb) throw new Error('Facebook non connecté');
  const res = await fetch(`${FB_GRAPH}/${fb.page_id}?fields=name,link,username,followers_count,instagram_business_account{username}&access_token=${encodeURIComponent(fb.access_token)}`, { cache: 'no-store' });
  return res.json();
}
