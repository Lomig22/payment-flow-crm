import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { supabase } from '@/lib/supabase';
import { imageDHash } from '@/lib/videoClean';

// Synchronisation du contenu Instagram (API Instagram avec connexion Instagram) :
// publications + stories et leurs statistiques, statistiques du compte par jour,
// rafraîchissement du token longue durée. Serveur uniquement (clé service).

const GRAPH = 'https://graph.instagram.com/v23.0';

export type ContentFormat = 'reel' | 'story' | 'post' | 'carousel';

interface TokenRow {
  account_username: string;
  ig_user_id:       string;
  access_token:     string;
  expires_at:       string | null;
  refreshed_at:     string;
}

interface IgMedia {
  id:                  string;
  media_product_type?: string;
  media_type?:         string;
  timestamp:           string;
  permalink?:          string;
  caption?:            string;
  thumbnail_url?:      string;
  media_url?:          string;
}

const METRICS: Record<ContentFormat, string> = {
  reel:     'views,reach,likes,comments,shares,saved,total_interactions,ig_reels_avg_watch_time',
  story:    'views,reach,replies,shares,total_interactions,profile_visits,follows',
  post:     'views,reach,likes,comments,shares,saved,total_interactions',
  carousel: 'views,reach,likes,comments,shares,saved,total_interactions',
};

const HOUR = 3_600_000;
const DAY  = 24 * HOUR;

export async function igGet<T>(path: string, token: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(path.startsWith('http') ? path : `${GRAPH}/${path}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  if (!url.searchParams.has('access_token')) url.searchParams.set('access_token', token);
  const res  = await fetch(url, { cache: 'no-store' });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

export async function igPost<T>(path: string, token: string, params: Record<string, string>): Promise<T> {
  const res  = await fetch(`${GRAPH}/${path}`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({ ...params, access_token: token }),
    cache:   'no-store',
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.error_user_msg ?? body.error?.message ?? `HTTP ${res.status}`);
  return body as T;
}

// Token de l'API pour un compte (null si le compte n'est pas connecté)
export async function getAccountToken(username: string): Promise<{ ig_user_id: string; access_token: string } | null> {
  const rows = await loadTokens();
  const row  = rows.find((t) => t.account_username === username);
  return row ? { ig_user_id: row.ig_user_id, access_token: row.access_token } : null;
}

function formatOf(m: IgMedia): ContentFormat {
  if (m.media_product_type === 'STORY') return 'story';
  if (m.media_product_type === 'REELS') return 'reel';
  return m.media_type === 'CAROUSEL_ALBUM' ? 'carousel' : 'post';
}

// Minuit du jour (J - daysAgo) dans le fuseau donné, en instant UTC.
function startOfDayInTz(tz: string, daysAgo = 0): Date {
  const now = new Date();
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: tz, hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(now).map((x) => [x.type, x.value]),
  );
  const tzAsUtc  = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMs = tzAsUtc - now.getTime();
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day - daysAgo) - offsetMs);
}

// Comptes à synchroniser. Premier lancement : le token de .env / Vercel
// (IG_ACCESS_TOKEN + IG_USER_ID) est recopié en base, qui devient la référence.
export async function loadTokens(): Promise<TokenRow[]> {
  const db = supabase as any;
  const { data, error } = await db.from('instagram_tokens').select('*');
  if (error) throw new Error(error.message);
  if (data?.length) return data;

  const token = process.env.IG_ACCESS_TOKEN;
  if (!token) return [];
  const me = await igGet<{ user_id: string; username: string }>('me', token, { fields: 'user_id,username' });
  const row = {
    account_username: me.username,
    ig_user_id:       process.env.IG_USER_ID || me.user_id,
    access_token:     token,
    expires_at:       new Date(Date.now() + 60 * DAY).toISOString(),
    refreshed_at:     new Date().toISOString(),
  };
  await db.from('instagram_tokens').upsert(row);
  return [row];
}

// Le token longue durée vit 60 jours ; on le prolonge chaque semaine.
async function refreshIfNeeded(tok: TokenRow): Promise<TokenRow> {
  if (Date.now() - new Date(tok.refreshed_at).getTime() < 7 * DAY) return tok;
  try {
    const r = await igGet<{ access_token: string; expires_in: number }>(
      'https://graph.instagram.com/refresh_access_token', tok.access_token,
      { grant_type: 'ig_refresh_token' },
    );
    const next = {
      ...tok,
      access_token: r.access_token,
      expires_at:   new Date(Date.now() + r.expires_in * 1000).toISOString(),
      refreshed_at: new Date().toISOString(),
    };
    await (supabase as any).from('instagram_tokens')
      .update({ access_token: next.access_token, expires_at: next.expires_at, refreshed_at: next.refreshed_at })
      .eq('account_username', tok.account_username);
    return next;
  } catch {
    return tok; // on retentera à la prochaine synchro
  }
}

// Faut-il relever les stats ? Contenu récent : à chaque synchro ; plus ancien : moins souvent
// (limite d'appels de l'API). Au-delà de 30 jours : jamais (historique gardé pour la
// détection des vidéos déjà publiées, sans stats).
function metricsDue(publishedAt: number, lastUpdate: number | null, format: ContentFormat): boolean {
  const age   = Date.now() - publishedAt;
  if (age >= 30 * DAY) return false;
  if (lastUpdate == null) return true;
  const since = Date.now() - lastUpdate;
  if (format === 'story' || age < 2 * DAY) return since > 20 * 60_000;
  if (age < 7 * DAY)  return since > 6 * HOUR;
  if (age < 30 * DAY) return since > DAY;
  return false;
}

async function mediaInsights(id: string, format: ContentFormat, token: string) {
  const r = await igGet<{ data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] }>(
    `${id}/insights`, token, { metric: METRICS[format] },
  );
  const v: Record<string, number> = {};
  for (const m of r.data) v[m.name] = Number(m.values?.[0]?.value ?? m.total_value?.value ?? 0);
  return {
    views:              v.views ?? null,
    reach:              v.reach ?? null,
    likes:              v.likes ?? null,
    comments:           v.comments ?? null,
    shares:             v.shares ?? null,
    saved:              v.saved ?? null,
    replies:            v.replies ?? null,
    profile_visits:     v.profile_visits ?? null,
    follows:            v.follows ?? null,
    total_interactions: v.total_interactions ?? null,
    avg_watch_time_ms:  v.ig_reels_avg_watch_time ?? null,
  };
}

async function syncAccountDaily(tok: TokenRow) {
  const db = supabase as any;
  const { followers_count } = await igGet<{ followers_count: number }>('me', tok.access_token, { fields: 'followers_count' });

  // Jour Instagram = heure du Pacifique. Aujourd'hui (en cours) et hier (consolidé).
  for (const daysAgo of [1, 0]) {
    const since = startOfDayInTz('America/Los_Angeles', daysAgo);
    const until = new Date(Math.min(since.getTime() + DAY, Date.now()));
    const r = await igGet<{ data: { name: string; total_value?: { value: number } }[] }>(
      `${tok.ig_user_id}/insights`, tok.access_token, {
        metric:      'views,reach,profile_views,accounts_engaged,total_interactions,website_clicks',
        period:      'day',
        metric_type: 'total_value',
        since:       String(Math.floor(since.getTime() / 1000)),
        until:       String(Math.floor(until.getTime() / 1000)),
      },
    );
    const v: Record<string, number> = {};
    for (const m of r.data) v[m.name] = Number(m.total_value?.value ?? 0);
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles' }).format(since);
    await db.from('ig_account_daily').upsert({
      account_username:   tok.account_username,
      day,
      views:              v.views ?? null,
      reach:              v.reach ?? null,
      profile_views:      v.profile_views ?? null,
      accounts_engaged:   v.accounts_engaged ?? null,
      total_interactions: v.total_interactions ?? null,
      website_clicks:     v.website_clicks ?? null,
      ...(daysAgo === 0 ? { followers_total: followers_count } : {}),
      updated_at:         new Date().toISOString(),
    });
  }
}

// Empreinte visuelle des miniatures publiées (détection des vidéos déjà postées).
// Borné par passage ; une miniature expirée côté Instagram est simplement ignorée.
async function hashThumbnails(account: string) {
  const db = supabase as any;
  const { data: rows } = await db.from('ig_content')
    .select('id, thumbnail_url')
    .eq('account_username', account)
    .in('format', ['reel', 'post', 'carousel'])
    .is('thumb_hash', null)
    .not('thumbnail_url', 'is', null)
    .order('published_at', { ascending: false })
    .limit(15);
  for (const r of rows ?? []) {
    const tmp = path.join(os.tmpdir(), `thumb-${r.id}.jpg`);
    try {
      const res = await fetch(r.thumbnail_url, { cache: 'no-store' });
      if (!res.ok) continue;
      await fs.writeFile(tmp, Buffer.from(await res.arrayBuffer()));
      await db.from('ig_content').update({ thumb_hash: await imageDHash(tmp) }).eq('id', r.id);
    } catch { /* miniature indisponible */ } finally {
      await fs.rm(tmp, { force: true });
    }
  }
}

export interface SyncResult {
  account:  string;
  media:    number;
  metrics:  number;
  errors:   string[];
}

async function syncAccount(tokIn: TokenRow): Promise<SyncResult> {
  const db  = supabase as any;
  const tok = await refreshIfNeeded(tokIn);
  const result: SyncResult = { account: tok.account_username, media: 0, metrics: 0, errors: [] };
  const fields = 'id,media_product_type,media_type,timestamp,permalink,caption,thumbnail_url,media_url';

  // Publications des 12 derniers mois (pagination ; les stats des plus anciennes ne sont
  // relevées qu'une fois, voir metricsDue) + stories en ligne. L'historique sert à
  // reconnaître une vidéo déjà publiée.
  const items: IgMedia[] = [];
  const horizon = Date.now() - 365 * DAY;
  let next: string | null = `${tok.ig_user_id}/media`;
  for (let page = 0; next && page < 6; page++) {
    const r: { data: IgMedia[]; paging?: { next?: string } } =
      page === 0 ? await igGet(next, tok.access_token, { fields, limit: '50' }) : await igGet(next, tok.access_token);
    items.push(...r.data);
    const oldest = r.data[r.data.length - 1];
    next = oldest && new Date(oldest.timestamp).getTime() > horizon ? r.paging?.next ?? null : null;
  }
  try {
    const s = await igGet<{ data: IgMedia[] }>(`${tok.ig_user_id}/stories`, tok.access_token, { fields });
    items.push(...s.data.map((m) => ({ ...m, media_product_type: 'STORY' })));
  } catch (e: any) {
    result.errors.push(`stories : ${e.message}`);
  }

  const recent = items.filter((m) => new Date(m.timestamp).getTime() > horizon);
  const { data: existing } = await db
    .from('ig_content')
    .select('id, ig_media_id, metrics_updated_at')
    .in('ig_media_id', recent.map((m) => m.id));
  const known = new Map<string, { id: string; metrics_updated_at: string | null }>(
    (existing ?? []).map((e: any) => [e.ig_media_id, e]),
  );

  // 8 publications à la fois (21/10/2026 : traitées une par une, 300 reels de @lomig_guegueniat
  // dépassaient les 60 s de Vercel) ; au-delà de 35 s, les stats attendent le passage suivant
  const started = Date.now();
  const one = async (m: IgMedia) => {
    const format      = formatOf(m);
    const publishedAt = new Date(m.timestamp).getTime();
    const prev        = known.get(m.id);
    const row: Record<string, unknown> = {
      ig_media_id:      m.id,
      account_username: tok.account_username,
      format,
      permalink:        m.permalink ?? null,
      caption:          m.caption ?? null,
      thumbnail_url:    m.thumbnail_url ?? (m.media_type === 'IMAGE' ? m.media_url : null) ?? null,
      published_at:     new Date(publishedAt).toISOString(),
    };
    // Reel sans vidéo fournie par l'API (musique de la bibliothèque Instagram) : jamais envoyable sur YouTube
    if (format === 'reel' && !m.media_url) {
      row.youtube = { status: 'skipped', error: 'Vidéo non fournie par Instagram (musique de la bibliothèque Instagram)' };
    }

    let metrics: Awaited<ReturnType<typeof mediaInsights>> | null = null;
    if (Date.now() - started < 35_000 && metricsDue(publishedAt, prev?.metrics_updated_at ? new Date(prev.metrics_updated_at).getTime() : null, format)) {
      try {
        metrics = await mediaInsights(m.id, format, tok.access_token);
        Object.assign(row, metrics, { metrics_updated_at: new Date().toISOString() });
      } catch (e: any) {
        result.errors.push(`${format} ${m.id} : ${e.message}`);
      }
    }

    const { data: saved, error } = await db
      .from('ig_content')
      .upsert(row, { onConflict: 'ig_media_id' })
      .select('id')
      .single();
    if (error) { result.errors.push(`${m.id} : ${error.message}`); return; }
    result.media++;

    if (metrics) {
      result.metrics++;
      await db.from('ig_content_metrics').insert({
        content_id:         saved.id,
        views:              metrics.views,
        reach:              metrics.reach,
        likes:              metrics.likes,
        comments:           metrics.comments,
        shares:             metrics.shares,
        saved:              metrics.saved,
        total_interactions: metrics.total_interactions,
      });
    }
  };
  for (let i = 0; i < recent.length; i += 8) await Promise.all(recent.slice(i, i + 8).map(one));

  try {
    await syncAccountDaily(tok);
  } catch (e: any) {
    result.errors.push(`compte : ${e.message}`);
  }

  await hashThumbnails(tok.account_username);

  await db.from('instagram_tokens')
    .update({ last_sync_at: new Date().toISOString(), last_sync_error: result.errors[0] ?? null })
    .eq('account_username', tok.account_username);
  return result;
}

export async function syncInstagramContent(): Promise<SyncResult[]> {
  const tokens  = await loadTokens();
  const results: SyncResult[] = [];
  for (const tok of tokens) {
    try {
      results.push(await syncAccount(tok));
    } catch (e: any) {
      results.push({ account: tok.account_username, media: 0, metrics: 0, errors: [e.message] });
      await (supabase as any).from('instagram_tokens')
        .update({ last_sync_error: e.message })
        .eq('account_username', tok.account_username);
    }
  }
  return results;
}
