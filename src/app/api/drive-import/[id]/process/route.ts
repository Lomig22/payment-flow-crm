import { NextRequest, NextResponse } from 'next/server';
import { hasCronKey } from '@/lib/cronAuth';
import { processQueueItem, QueueProcessError } from '@/lib/queueProcess';
import { captionQueueItem } from '@/lib/captionAI';
import { autoScheduleDrafts } from '@/lib/autoSchedule';

// Import Google Drive, étape 2 : nettoyage des métadonnées + contrôle d'intégrité,
// puis légende automatique si possible (sinon à écrire dans le CRM).
export const dynamic     = 'force-dynamic';
// Réencodage de la fin CTA : plus de 60 s pour les vidéos de plus de ~20 Mo
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });

  try {
    const processed = await processQueueItem(params.id);
    // Déjà publiée : pas d'entrée dans la file, le script range le fichier à part
    if (processed.status === 'duplicate') return NextResponse.json(processed);
    let caption: string | null = null;
    try {
      caption = (await captionQueueItem(params.id)).caption;
    } catch { /* légende à écrire à la main (clé ou crédits Claude absents) */ }
    const auto_scheduled = await autoScheduleDrafts();
    return NextResponse.json({ ...processed, caption, auto_scheduled });
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: e instanceof QueueProcessError ? e.status : 500 });
  }
}
