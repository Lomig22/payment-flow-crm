import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCronKey } from '@/lib/cronAuth';
import { facebookReelStatus, facebookPageInfo } from '@/lib/crosspost';

// Vérification des Reels Facebook envoyés : état réel côté Facebook des derniers cross-posts.
// Protégé par CRON_SECRET.
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const limit = Math.min(20, Number(request.nextUrl.searchParams.get('n') ?? 8));
  const { data } = await (supabase as any).from('content_queue').select('id, published_at, crosspost')
    .eq('status', 'published').eq('crosspost->facebook->>status', 'done')
    .order('published_at', { ascending: false }).limit(limit);
  const out = [];
  for (const r of data ?? []) {
    const id = r.crosspost.facebook.id;
    out.push({ queue_id: r.id, published_at: r.published_at, fb_id: id, facebook: await facebookReelStatus(id).catch((e) => ({ error: e.message })) });
  }
  return NextResponse.json({ page: await facebookPageInfo().catch((e) => ({ error: e.message })), reels: out });
}
