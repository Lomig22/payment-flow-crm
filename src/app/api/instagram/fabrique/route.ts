import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';

// Page Fabrique : les reels du compte agence écrits par Claude, leur vidéo rendue et leur validation
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const db = supabase as any;
  const { data: reels, error } = await db.from('agency_reels')
    .select('id, day, funnel, topic, caption, status, voiced, review_status, feedback, error, queue_id, created_at')
    .neq('status', 'failed').order('created_at', { ascending: false }).limit(60);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  const ids = (reels ?? []).map((r: any) => r.queue_id).filter(Boolean);
  const { data: queue } = ids.length
    ? await db.from('content_queue').select('id, status, media_url, frame_paths, scheduled_at, published_at, permalink, error').in('id', ids)
    : { data: [] };
  const byId = new Map((queue ?? []).map((q: any) => [q.id, q]));
  const preview = supabase.storage.from(MEDIA_BUCKET).getPublicUrl('agency/apercu/modele.mp4').data.publicUrl;
  return NextResponse.json({
    preview_url: preview,
    reels: (reels ?? []).map((r: any) => {
      const q: any = byId.get(r.queue_id);
      return {
        ...r,
        video_url: q?.media_url ?? null,
        cover_url: q?.frame_paths?.[0] ? supabase.storage.from(MEDIA_BUCKET).getPublicUrl(q.frame_paths[0]).data.publicUrl : null,
        queue_status: q?.status ?? null, scheduled_at: q?.scheduled_at ?? null, published_at: q?.published_at ?? null, permalink: q?.permalink ?? null,
        queue_error: q?.error ?? null,
      };
    }),
  });
}
