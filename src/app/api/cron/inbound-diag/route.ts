import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCronKey } from '@/lib/cronAuth';
import { igGet, loadTokens } from '@/lib/instagramGraph';

// Diagnostic inbound (lecture seule) : ce que les API Meta exposent réellement sur les derniers
// contenus (commentaires et leurs auteurs, réactions, abonnés), Instagram et Page Facebook.
// Les noms des personnes ne sont pas renvoyés : seulement des comptes et des exemples tronqués.
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const FB = 'https://graph.facebook.com/v23.0';
async function fbGet(path: string, token: string, params: Record<string, string> = {}) {
  const u = new URL(`${FB}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  u.searchParams.set('access_token', token);
  const r = await fetch(u, { cache: 'no-store' });
  return r.json();
}
const mask = (s?: string) => (s ? `${s.slice(0, 2)}…(${s.length})` : null);

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const out: any = { instagram: [], facebook: {} };

  // Instagram : 5 derniers contenus avec commentaires
  try {
    const tok = (await loadTokens())[0];
    const { data: media } = await (supabase as any).from('ig_content').select('ig_media_id, comments, likes, published_at')
      .eq('account_username', tok.account_username).gt('comments', 0).order('published_at', { ascending: false }).limit(5);
    for (const m of media ?? []) {
      try {
        const c = await igGet<{ data: any[] }>(`${m.ig_media_id}/comments`, tok.access_token, { fields: 'id,text,timestamp,username,from', limit: '50' });
        out.instagram.push({ media: m.ig_media_id, comments_count: m.comments, returned: c.data.length,
          with_author: c.data.filter((x) => x.username || x.from?.username).length, sample: c.data.slice(0, 2).map((x) => ({ who: mask(x.username ?? x.from?.username), text: mask(x.text) })) });
      } catch (e: any) { out.instagram.push({ media: m.ig_media_id, error: e.message }); }
    }
    try {
      const me = await igGet<any>('me', tok.access_token, { fields: 'followers_count' });
      out.instagram_followers = { count: me.followers_count };
      const f = await igGet<any>('me/followers', tok.access_token, {}).catch((e: any) => ({ error: e.message }));
      out.instagram_followers.list = f.error ? `indisponible : ${f.error}` : 'disponible';
    } catch (e: any) { out.instagram_followers = { error: e.message }; }
  } catch (e: any) { out.instagram_error = e.message; }

  // Facebook : derniers contenus de la Page, commentaires, réactions
  const { data: fbRow } = await (supabase as any).from('platform_tokens').select('data').eq('platform', 'facebook').maybeSingle();
  const fb = fbRow?.data;
  if (fb?.access_token) {
    const perms = await fbGet('me/permissions', fb.access_token);
    out.facebook.permissions = perms.data?.filter((p: any) => p.status === 'granted').map((p: any) => p.permission) ?? perms.error?.message;
    const debug = await fbGet(fb.page_id, fb.access_token, { fields: 'name,followers_count,fan_count' });
    out.facebook.page = { name: debug.name, followers: debug.followers_count, fans: debug.fan_count, error: debug.error?.message };
    const feed = await fbGet(`${fb.page_id}/feed`, fb.access_token, { fields: 'id,created_time,comments.summary(true).limit(5){from,message,created_time},reactions.summary(true).limit(5){id,name,type}', limit: '15' });
    if (feed.error) out.facebook.feed_error = feed.error.message;
    out.facebook.posts = (feed.data ?? []).filter((p: any) => (p.comments?.summary?.total_count ?? 0) + (p.reactions?.summary?.total_count ?? 0) > 0).slice(0, 8).map((p: any) => ({
      id: p.id, at: p.created_time,
      comments: p.comments?.summary?.total_count ?? 0, comments_returned: p.comments?.data?.length ?? 0,
      comments_with_author: (p.comments?.data ?? []).filter((c: any) => c.from?.id).length,
      comment_sample: (p.comments?.data ?? []).slice(0, 2).map((c: any) => ({ who: mask(c.from?.name), text: mask(c.message) })),
      reactions: p.reactions?.summary?.total_count ?? 0, reactions_with_name: (p.reactions?.data ?? []).filter((r: any) => r.name).length,
    }));
    const reels = await fbGet(`${fb.page_id}/video_reels`, fb.access_token, { fields: 'id,created_time,comments.summary(true).limit(5){from,message},likes.summary(true)', limit: '15' });
    if (reels.error) out.facebook.reels_error = reels.error.message;
    out.facebook.reels = (reels.data ?? []).filter((r: any) => (r.comments?.summary?.total_count ?? 0) > 0).slice(0, 8).map((r: any) => ({
      id: r.id, at: r.created_time, comments: r.comments?.summary?.total_count ?? 0, returned: r.comments?.data?.length ?? 0,
      with_author: (r.comments?.data ?? []).filter((c: any) => c.from?.id).length,
      sample: (r.comments?.data ?? []).slice(0, 2).map((c: any) => ({ who: mask(c.from?.name), text: mask(c.message) })),
      likes: r.likes?.summary?.total_count ?? null,
    }));
  }
  return NextResponse.json(out);
}
