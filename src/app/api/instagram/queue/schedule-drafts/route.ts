import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { autoScheduleDrafts } from '@/lib/autoSchedule';
import { voiceoverBlocks } from '@/lib/voiceover';

// « Valider et programmer » : mêmes créneaux que le pilote automatique (intervalle,
// plage horaire et objectif du jour réglés dans la page Publication).
// Renvoie aussi les reels bloqués par la voix off, pour un message clair quand rien ne part.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const acc = request.nextUrl.searchParams.get('account') ?? undefined;
  // « Valider et programmer » vaut validation des reels de la fabrique (compte agence) encore en
  // attente : sans ça, ils restaient retenus et rien ne partait (« aucun créneau libre », 16/10/2026)
  let dq = (supabase as any).from('content_queue').select('id').eq('status', 'draft');
  if (acc) dq = dq.eq('account_username', acc);
  const { data: draftIds } = await dq;
  const ids = (draftIds ?? []).map((d: any) => d.id);
  if (ids.length) {
    await (supabase as any).from('agency_reels').update({ review_status: 'approved', reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .in('queue_id', ids).eq('review_status', 'pending');
  }
  const scheduled = await autoScheduleDrafts(acc, true);
  let q = (supabase as any).from('content_queue').select('file_name, format, caption, clean_report').eq('status', 'draft');
  if (acc) q = q.eq('account_username', acc);
  const { data: drafts } = await q;
  const blocked = (drafts ?? [])
    .filter((d: any) => d.format === 'reel' && voiceoverBlocks(d.clean_report))
    .map((d: any) => ({ file_name: d.file_name, reason: voiceoverBlocks(d.clean_report) }));
  const no_caption = (drafts ?? []).filter((d: any) => d.format === 'reel' && !d.caption?.trim()).length;
  return NextResponse.json({ scheduled, blocked, no_caption });
}
