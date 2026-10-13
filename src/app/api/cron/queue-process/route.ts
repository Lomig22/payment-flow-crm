import { NextRequest, NextResponse } from 'next/server';
import { hasCronKey } from '@/lib/cronAuth';
import { processNextUploaded } from '@/lib/queueProcess';
import { captionQueueItem, captionMissing } from '@/lib/captionAI';

// Traitement en arrière-plan des vidéos envoyées depuis la page Publication (sprint45) :
// une vidéo par appel (nettoyage, fin CTA, analyse audio, empreintes anti-doublon), puis sa
// légende si le temps le permet ; sans vidéo à traiter, rattrapage d'une légende manquante.
// Appelé chaque minute par le cron du VPS (deux appels en parallèle). Protégé par CRON_SECRET.
export const dynamic     = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const started = Date.now();
  const done = await processNextUploaded();
  let captioned = false;
  if (done && ['draft', 'scheduled'].includes(done.status) && Date.now() - started < 200_000) {
    captioned = await captionQueueItem(done.id).then(() => true).catch(() => false);
  } else if (!done) {
    captioned = (await captionMissing(1)) > 0;
  }
  return NextResponse.json({ processed: done, captioned, ms: Date.now() - started });
}
