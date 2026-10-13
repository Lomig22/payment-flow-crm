import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { captionQueueItem } from '@/lib/captionAI';
import { autoScheduleDrafts } from '@/lib/autoSchedule';

// Légende + hashtags rédigés par Claude à partir des images du reel.
// Écrase la légende existante seulement avec { force: true } (bouton « Réécrire »).
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { force } = await request.json().catch(() => ({ force: false }));
  try {
    const result = await captionQueueItem(params.id, !!force);
    // Légende prête : le pilote automatique (s'il est activé) programme la vidéo
    await autoScheduleDrafts();
    return NextResponse.json(result);
  } catch (e: any) {
    return NextResponse.json({ message: `Légende automatique impossible : ${e.message}` }, { status: 502 });
  }
}
