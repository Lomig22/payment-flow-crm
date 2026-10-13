import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { youtubeQuotaLeft, YT_DAILY_LIMIT } from '@/lib/crosspost';

// Vue « YouTube Shorts » : quota du jour, Shorts en attente (nouveaux reels d'abord,
// puis l'historique du plus récent au plus ancien), envoyés, ignorés et en échec.
export const dynamic = 'force-dynamic';


export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { data: yt } = await db.from('platform_tokens').select('data').eq('platform', 'youtube').maybeSingle();
  if (!yt?.data) return NextResponse.json({ connected: false });

  const [{ data: queue }, { data: reels }] = await Promise.all([
    db.from('content_queue').select('id, ig_media_id, caption, status, scheduled_at, published_at, crosspost')
      .eq('format', 'reel').in('status', ['scheduled', 'publishing', 'published']).order('scheduled_at', { ascending: true }),
    db.from('ig_content').select('id, ig_media_id, caption, thumbnail_url, permalink, published_at, youtube')
      .eq('format', 'reel').order('published_at', { ascending: false }),
  ]);

  type Item = { key: string; title: string; source: 'nouveau' | 'historique'; date: string | null; thumbnail: string | null; instagram: string | null; status: string; url?: string; warning?: string; error?: string };
  const title = (c: string | null) => (c ?? '').split('\n')[0].slice(0, 80) || 'Sans légende';
  const thumbs = new Map((reels ?? []).map((r: any) => [r.ig_media_id, r]));
  const viaCrosspost = new Set<string>();
  const items: Item[] = [];

  // Nouveaux reels (cross-post) : programmés, ou publiés avec un envoi YouTube suivi
  for (const q of queue ?? []) {
    const y = q.crosspost?.youtube;
    if (q.status === 'published' && !y) continue;          // publié avant la connexion : rattrapage
    if (q.ig_media_id) viaCrosspost.add(q.ig_media_id);
    const r: any = q.ig_media_id ? thumbs.get(q.ig_media_id) : null;
    items.push({
      key: `q-${q.id}`, title: title(q.caption), source: 'nouveau', date: q.published_at ?? q.scheduled_at,
      thumbnail: r?.thumbnail_url ?? null, instagram: r?.permalink ?? null,
      status: q.status !== 'published' ? 'scheduled' : y.status, url: y?.url, warning: y?.warning, error: y?.error,
    });
  }
  // Historique (rattrapage)
  for (const r of reels ?? []) {
    if (viaCrosspost.has(r.ig_media_id)) continue;
    const y = r.youtube;
    items.push({
      key: `c-${r.id}`, title: title(r.caption), source: 'historique', date: r.published_at,
      thumbnail: r.thumbnail_url, instagram: r.permalink,
      status: y?.status ?? 'pending', url: y?.url, warning: y?.warning, error: y?.error,
    });
  }

  const left = await youtubeQuotaLeft();
  const sentToday = yt.data.quota_day === new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(new Date())
    ? Math.min(yt.data.uploads_today ?? 0, YT_DAILY_LIMIT) : 0;
  const pending = [
    ...items.filter((i) => i.source === 'nouveau' && ['pending', 'scheduled'].includes(i.status)),
    ...items.filter((i) => i.source === 'historique' && i.status === 'pending'),
  ];
  return NextResponse.json({
    connected: true,
    channel:   yt.data.channel_title ?? null,
    // exhausted : YouTube a refusé (quota du jour atteint) — reprise vers 9 h, heure de Paris
    quota:     { sent: left <= 0 ? null : sentToday, limit: YT_DAILY_LIMIT, exhausted: left <= 0 },
    pending,
    done:      items.filter((i) => i.status === 'done').sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')).slice(0, 30),
    skipped:   items.filter((i) => i.status === 'skipped').length,
    failed:    items.filter((i) => i.status === 'failed'),
  });
}
