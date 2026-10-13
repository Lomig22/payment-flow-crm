import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Partage d'un reel publié sur le profil Facebook personnel (fait à la main en 2 clics :
// Meta interdit la publication sur un profil par API) : marqué partagé ou ignoré.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { status } = await request.json();
  if (!['shared', 'skipped'].includes(status)) return badRequest('Statut invalide');

  const db = supabase as any;
  const { data: row } = await db.from('content_queue').select('id, crosspost').eq('id', params.id).single();
  if (!row) return notFound('Contenu introuvable');
  const crosspost = { ...(row.crosspost ?? {}), profile: { status, at: new Date().toISOString() } };
  await db.from('content_queue').update({ crosspost }).eq('id', row.id);
  return NextResponse.json({ ok: true });
}
