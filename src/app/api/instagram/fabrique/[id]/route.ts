import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { reviewReel } from '@/lib/agencyReels';

// Validation d'un reel de la fabrique : « approve » le programme, « reject » le retire ; le
// commentaire est transmis à Claude pour les reels suivants
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const { action, feedback } = await request.json().catch(() => ({}));
  if (!['approve', 'reject'].includes(action)) return badRequest('Action invalide');
  try {
    return NextResponse.json(await reviewReel(params.id, action, typeof feedback === 'string' ? feedback.slice(0, 2000) : undefined));
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
