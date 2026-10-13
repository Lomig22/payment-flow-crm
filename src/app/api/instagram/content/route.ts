import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { startOfTodayParis } from '@/lib/paris-time';

// Vue « Contenu » : publications du jour vs objectifs, 7 derniers jours,
// stats du compte et leads inbound attribués aux contenus.
export const dynamic = 'force-dynamic';

const DAYS = 7;
const parisDay = (iso: string | Date) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { data: tokens, error: tokErr } = await db
    .from('instagram_tokens')
    .select('account_username, expires_at, last_sync_at, last_sync_error')
    .order('account_username');
  if (tokErr) return NextResponse.json({ message: tokErr.message }, { status: 500 });

  const requested = request.nextUrl.searchParams.get('account');
  const account   = tokens?.find((t: any) => t.account_username === requested) ?? tokens?.[0] ?? null;
  const username  = account?.account_username ?? process.env.IG_DEFAULT_ACCOUNT ?? 'lomig_guegueniat';

  // Fenêtre : 7 jours calendaires, heure de Paris (aujourd'hui inclus)
  const from = new Date(startOfTodayParis().getTime() - (DAYS - 1) * 86_400_000);
  const days = Array.from({ length: DAYS }, (_, i) => parisDay(new Date(from.getTime() + i * 86_400_000 + 12 * 3_600_000)));

  const [targetsRes, contentRes, dailyRes, leadsRes] = await Promise.all([
    db.from('content_targets').select('format, per_day').eq('account_username', username),
    db.from('ig_content')
      .select('id, format, permalink, caption, thumbnail_url, published_at, views, reach, likes, comments, shares, saved, replies, profile_visits, follows, total_interactions, avg_watch_time_ms, metrics_updated_at')
      .eq('account_username', username)
      .gte('published_at', from.toISOString())
      .order('published_at', { ascending: false }),
    db.from('ig_account_daily').select('*').eq('account_username', username).order('day', { ascending: false }).limit(DAYS + 1),
    db.from('leads')
      .select('id, created_at, inbound_channel, origin_content_id')
      .eq('origin', 'inbound')
      .gte('created_at', from.toISOString()),
  ]);
  const err = targetsRes.error ?? contentRes.error ?? dailyRes.error ?? leadsRes.error;
  if (err) return NextResponse.json({ message: err.message }, { status: 500 });

  const targets: Record<string, number> = {};
  for (const t of targetsRes.data ?? []) targets[t.format] = t.per_day;

  const leadsByContent = new Map<string, number>();
  for (const l of leadsRes.data ?? []) {
    if (l.origin_content_id) leadsByContent.set(l.origin_content_id, (leadsByContent.get(l.origin_content_id) ?? 0) + 1);
  }

  const content = (contentRes.data ?? []).map((c: any) => ({
    ...c,
    day:   parisDay(c.published_at),
    leads: leadsByContent.get(c.id) ?? 0,
  }));

  const history = days.map((day) => {
    const ofDay = content.filter((c: any) => c.day === day);
    const count = (f: string) => ofDay.filter((c: any) => c.format === f).length;
    return {
      day,
      reel:     count('reel'),
      story:    count('story'),
      post:     count('post'),
      carousel: count('carousel'),
      views:    ofDay.reduce((s: number, c: any) => s + (c.views ?? 0), 0),
      leads:    (leadsRes.data ?? []).filter((l: any) => parisDay(l.created_at) === day).length,
    };
  }).reverse();

  return NextResponse.json({
    account:  username,
    accounts: (tokens ?? []).map((t: any) => t.account_username),
    sync: account
      ? { last_sync_at: account.last_sync_at, last_sync_error: account.last_sync_error, token_expires_at: account.expires_at }
      : null,
    targets,
    today:        history[0],
    history,
    account_daily: dailyRes.data ?? [],
    content,
    inbound_leads: (leadsRes.data ?? []).length,
  });
}
