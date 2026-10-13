import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { startOfTodayParis } from '@/lib/paris-time';

// Alarme de publication : dernier post (reel / post / carrousel) et dernière story
// connus par la synchro, compteurs du jour et objectifs.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { data: tok } = await db.from('instagram_tokens')
    .select('account_username, last_sync_at').order('account_username').limit(1).maybeSingle();
  const account = tok?.account_username ?? 'lomig_guegueniat';
  const today   = startOfTodayParis().toISOString();

  const [lastPost, lastStory, todayRows, targets] = await Promise.all([
    db.from('ig_content').select('published_at').eq('account_username', account)
      .in('format', ['reel', 'post', 'carousel']).order('published_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('ig_content').select('published_at').eq('account_username', account)
      .eq('format', 'story').order('published_at', { ascending: false }).limit(1).maybeSingle(),
    db.from('ig_content').select('format').eq('account_username', account).gte('published_at', today),
    db.from('content_targets').select('format, per_day').eq('account_username', account),
  ]);

  // Reels publiés par le CRM depuis 48 h, pas encore partagés sur le profil Facebook perso
  // (Meta ne permet pas de publier sur un profil personnel par API : partage en 2 clics)
  const { data: toShare } = await db.from('content_queue')
    .select('id, caption, permalink, published_at, crosspost')
    .eq('account_username', account).eq('status', 'published').eq('format', 'reel')
    .gte('published_at', new Date(Date.now() - 48 * 3_600_000).toISOString())
    .order('published_at', { ascending: false });
  const profile_share = (toShare ?? [])
    .filter((r: any) => !r.crosspost?.profile?.status)
    .map((r: any) => ({
      id:           r.id,
      title:        (r.caption ?? '').split('\n')[0].slice(0, 70),
      published_at: r.published_at,
      // Partager le reel de la Page s'il existe (vidéo lue sur Facebook), sinon le lien Instagram
      share_url:    r.crosspost?.facebook?.url ?? r.permalink,
    }))
    .filter((r: any) => r.share_url);

  const count = (f: string) => (todayRows.data ?? []).filter((r: any) => r.format === f).length;
  const target = (f: string) => (targets.data ?? []).find((t: any) => t.format === f)?.per_day ?? 0;

  return NextResponse.json({
    account,
    last_sync_at:  tok?.last_sync_at ?? null,
    last_post_at:  lastPost.data?.published_at ?? null,
    last_story_at: lastStory.data?.published_at ?? null,
    today:   { posts: count('reel') + count('post') + count('carousel'), stories: count('story') },
    targets: { reel: target('reel'), story: target('story') },
    profile_share,
  });
}
