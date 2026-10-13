import crypto from 'crypto';
import { supabase } from '@/lib/supabase';

// TikTok (Content Posting API) : connexion du compte (OAuth Login Kit) et publication
// directe d'une vidéo en envoi de fichier. Tant que l'app n'est pas auditée par TikTok,
// seule la confidentialité « SELF_ONLY » (privé) est proposée : la vidéo arrive en privé.

const API = 'https://open.tiktokapis.com/v2';
export const TIKTOK_SCOPES = 'user.info.basic,video.publish';

export const tiktokRedirectUri = () =>
  `${process.env.APP_URL ?? 'https://payment-flow-crm-delta.vercel.app'}/api/tiktok/callback`;

// state signé (pas de session côté serveur) : horodatage + HMAC, valable 15 min
export function signState(): string {
  const ts = Date.now().toString();
  const mac = crypto.createHmac('sha256', process.env.CRON_SECRET ?? '').update(ts).digest('hex').slice(0, 32);
  return `${ts}.${mac}`;
}
export function verifyState(state: string | null): boolean {
  const [ts, mac] = (state ?? '').split('.');
  if (!ts || !mac || Date.now() - Number(ts) > 15 * 60_000) return false;
  const expected = crypto.createHmac('sha256', process.env.CRON_SECRET ?? '').update(ts).digest('hex').slice(0, 32);
  return crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected));
}

export function tiktokAuthUrl(): string {
  return 'https://www.tiktok.com/v2/auth/authorize/?' + new URLSearchParams({
    client_key:    process.env.TIKTOK_CLIENT_KEY ?? '',
    scope:         TIKTOK_SCOPES,
    response_type: 'code',
    redirect_uri:  tiktokRedirectUri(),
    state:         signState(),
  });
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch(`${API}/oauth/token/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: process.env.TIKTOK_CLIENT_KEY ?? '', client_secret: process.env.TIKTOK_CLIENT_SECRET ?? '', ...params }),
  });
  const b = await res.json();
  if (!res.ok || b.error) throw new Error(`TikTok : ${b.error_description ?? b.error ?? res.status}`);
  return b as { open_id: string; access_token: string; expires_in: number; refresh_token: string; refresh_expires_in: number };
}

// Code d'autorisation → jetons, enregistrés dans platform_tokens
export async function connectTikTok(code: string): Promise<string> {
  const t = await tokenRequest({ code, grant_type: 'authorization_code', redirect_uri: tiktokRedirectUri() });
  const me = await fetch(`${API}/user/info/?fields=display_name`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then((r) => r.json());
  const display_name = me?.data?.user?.display_name ?? null;
  await (supabase as any).from('platform_tokens').upsert({
    platform: 'tiktok',
    data: {
      open_id: t.open_id, access_token: t.access_token, refresh_token: t.refresh_token,
      access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(),
      display_name, enabled: true,
    },
    updated_at: new Date().toISOString(),
  });
  return display_name ?? t.open_id;
}

// Jeton d'accès valide (24 h) : rafraîchi si besoin avec le refresh token (365 j)
async function accessToken(tk: any): Promise<string> {
  if (tk.access_expires_at && new Date(tk.access_expires_at).getTime() - Date.now() > 5 * 60_000) return tk.access_token;
  const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: tk.refresh_token });
  const data = { ...tk, access_token: t.access_token, refresh_token: t.refresh_token, access_expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString() };
  await (supabase as any).from('platform_tokens').update({ data, updated_at: new Date().toISOString() }).eq('platform', 'tiktok');
  return t.access_token;
}

async function call(path: string, token: string, body: unknown) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json; charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const b = await res.json();
  if (b.error?.code && b.error.code !== 'ok') throw new Error(`TikTok : ${b.error.message || b.error.code}`);
  return b.data;
}

// Publication directe d'une vidéo (envoi du fichier en un seul morceau, ≤ 64 Mo)
export async function postTikTok(tk: any, video: Buffer, caption: string): Promise<{ id: string; url?: string; warning?: string }> {
  const token   = await accessToken(tk);
  const creator = await call('/post/publish/creator_info/query/', token, {});
  const options: string[] = creator?.privacy_level_options ?? ['SELF_ONLY'];
  const privacy = options.includes('PUBLIC_TO_EVERYONE') ? 'PUBLIC_TO_EVERYONE' : options[0];

  const init = await call('/post/publish/video/init/', token, {
    post_info: {
      title: caption.slice(0, 2200), privacy_level: privacy,
      disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000,
    },
    source_info: { source: 'FILE_UPLOAD', video_size: video.length, chunk_size: video.length, total_chunk_count: 1 },
  });
  const up = await fetch(init.upload_url, {
    method: 'PUT',
    headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(video.length), 'Content-Range': `bytes 0-${video.length - 1}/${video.length}` },
    body: new Uint8Array(video),
  });
  if (!up.ok) throw new Error(`TikTok : envoi refusé (${up.status})`);

  return {
    id: init.publish_id,
    url: creator?.creator_username ? `https://www.tiktok.com/@${creator.creator_username}` : undefined,
    warning: privacy !== 'PUBLIC_TO_EVERYONE' ? `Vidéo en « ${privacy} » : audit TikTok nécessaire pour publier en public automatiquement` : undefined,
  };
}
