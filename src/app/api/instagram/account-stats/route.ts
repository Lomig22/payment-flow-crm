import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { igGet, getAccountToken } from '@/lib/instagramGraph';
import { startOfTodayParis } from '@/lib/paris-time';

// Statistiques du profil Instagram sur une période (aujourd'hui, 7 jours, 30 jours),
// comparées à la période précédente : lues en direct dans l'API Instagram (valeurs
// dédoublonnées sur la période, ce que la somme de jours ne donne pas pour la portée).
export const dynamic = 'force-dynamic';

const METRICS = ['views', 'reach', 'profile_views', 'accounts_engaged', 'total_interactions',
  'website_clicks', 'profile_links_taps', 'likes', 'comments', 'shares', 'saves'];
const DAY = 86_400_000;

type Values = Record<string, number>;

async function totals(igUserId: string, token: string, since: Date, until: Date): Promise<Values> {
  const base = { period: 'day', metric_type: 'total_value', since: String(Math.floor(since.getTime() / 1000)), until: String(Math.floor(until.getTime() / 1000)) };
  const [m, f] = await Promise.all([
    igGet<{ data: { name: string; total_value?: { value: number } }[] }>(`${igUserId}/insights`, token, { ...base, metric: METRICS.join(',') }),
    igGet<{ data: { total_value?: { breakdowns?: { results: { dimension_values: string[]; value: number }[] }[] } }[] }>(
      `${igUserId}/insights`, token, { ...base, metric: 'follows_and_unfollows', breakdown: 'follow_type' }),
  ]);
  const out: Values = {};
  for (const x of m.data) out[x.name] = Number(x.total_value?.value ?? 0);
  for (const r of f.data[0]?.total_value?.breakdowns?.[0]?.results ?? []) {
    if (r.dimension_values[0] === 'FOLLOWER') out.follows = r.value;
    if (r.dimension_values[0] === 'NON_FOLLOWER') out.unfollows = r.value;
  }
  out.follows ??= 0; out.unfollows ??= 0;
  return out;
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const period = request.nextUrl.searchParams.get('period') ?? 'week';
  const db = supabase as any;
  const { data: tokRow } = await db.from('instagram_tokens').select('account_username').order('account_username').limit(1).maybeSingle();
  const account = tokRow?.account_username ?? 'lomig_guegueniat';
  const tok = await getAccountToken(account);
  if (!tok) return NextResponse.json({ message: 'Compte Instagram non connecté' }, { status: 400 });

  // Période en cours et période précédente de même durée
  const until = new Date();
  const since = period === 'day' ? startOfTodayParis() : new Date(until.getTime() - (period === 'month' ? 30 : 7) * DAY);
  const span  = until.getTime() - since.getTime();
  const prevSince = new Date(since.getTime() - span);

  try {
    const [current, previous, me, daily, top, leads] = await Promise.all([
      totals(tok.ig_user_id, tok.access_token, since, until),
      totals(tok.ig_user_id, tok.access_token, prevSince, since),
      igGet<{ followers_count: number; media_count: number }>('me', tok.access_token, { fields: 'followers_count,media_count' }),
      db.from('ig_account_daily').select('day, views, reach, profile_views, website_clicks, accounts_engaged')
        .eq('account_username', account).gte('day', new Date(until.getTime() - 30 * DAY).toISOString().slice(0, 10)).order('day'),
      db.from('ig_content').select('id, format, caption, permalink, thumbnail_url, published_at, views, likes, comments, shares, saved')
        .eq('account_username', account).neq('format', 'story').gte('published_at', since.toISOString())
        .order('views', { ascending: false, nullsFirst: false }).limit(5),
      db.from('leads').select('id', { count: 'exact', head: true }).eq('origin', 'inbound').gte('created_at', since.toISOString()),
    ]);
    return NextResponse.json({
      account, period, since: since.toISOString(),
      followers: me.followers_count,
      current, previous,
      inbound_leads: leads.count ?? 0,
      daily: daily.data ?? [],
      top: top.data ?? [],
    });
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 502 });
  }
}
