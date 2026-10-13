import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { processQueueItem, markUploaded, QueueProcessError } from '@/lib/queueProcess';

// Après l'envoi de la vidéo brute depuis le CRM : nettoyage des métadonnées et
// contrôle d'intégrité (voir processQueueItem).
// ?defer=1 : marque seulement la vidéo comme envoyée ; le cron du VPS la traite ensuite
// (/api/cron/queue-process), sans que la page ait à rester ouverte.
export const dynamic     = 'force-dynamic';
// Réencodage de la fin CTA : plus de 60 s pour les vidéos de plus de ~20 Mo
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  if (request.nextUrl.searchParams.get('defer') === '1') {
    return (await markUploaded(params.id))
      ? NextResponse.json({ id: params.id, status: 'queued' })
      : NextResponse.json({ message: 'Vidéo déjà traitée' }, { status: 409 });
  }
  try {
    return NextResponse.json(await processQueueItem(params.id));
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: e instanceof QueueProcessError ? e.status : 500 });
  }
}
