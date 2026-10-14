import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { syncInstagramContent } from '@/lib/instagramGraph';
import { publishDue } from '@/lib/instagramPublish';
import { syncInbound } from '@/lib/instagramInbound';
import { syncFacebookComments } from '@/lib/inbound';
import { cleanupStaleUploads } from '@/lib/queueProcess';
import { autoScheduleDrafts } from '@/lib/autoSchedule';
import { captionMissing } from '@/lib/captionAI';
import { crossPostDue } from '@/lib/crosspost';
import { youtubeBackfillOne } from '@/lib/youtubeBackfill';

// Publication des contenus programmés (file de publication), puis synchro
// automatique du contenu Instagram (publications, stories, stats du compte).
// À appeler toutes les 5 min par un planificateur externe (cron-job.org) : les
// reels programmés partent ainsi à l'heure (au plus ~5 min de décalage).
// Protégé par CRON_SECRET (header « Authorization: Bearer … » ou ?key=).

export const dynamic     = 'force-dynamic';

async function lastSyncOlderThan(ms: number): Promise<boolean> {
  const { data } = await (supabase as any).from('instagram_tokens').select('last_sync_at');
  return !data?.length || data.some((t: any) => !t.last_sync_at || Date.now() - new Date(t.last_sync_at).getTime() > ms);
}
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth   = request.headers.get('authorization');
  const key    = request.nextUrl.searchParams.get('key');
  if (!secret || (auth !== `Bearer ${secret}` && key !== secret)) {
    return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  }

  const started = Date.now();
  try {
    // D'abord les publications programmées (temps borné), puis la synchro des stats.
    // Si on a publié, la synchro attend le passage suivant : cron-job.org coupe à 30 s.
    const published = await publishDue(20_000);
    // Cross-post Facebook / YouTube des reels publiés (borné, reprise au passage suivant)
    const crossposted = await crossPostDue(published.length ? 10_000 : 20_000);
    // Le cron passe toutes les 5 min pour publier à l'heure ; la synchro des stats et la
    // captation inbound ne tournent que toutes les 15 min (limite d'appels Instagram).
    const syncDue   = !published.length && !crossposted.length && await lastSyncOlderThan(15 * 60_000);
    // Rattrapage YouTube de l'historique : un reel par passage léger (ni publication, ni
    // cross-post, ni synchro due), dans le quota du jour
    const backfilled = !published.length && !crossposted.length && !syncDue && Date.now() - started < 10_000 ? await youtubeBackfillOne() : null;
    const synced    = syncDue ? await syncInstagramContent() : [];
    // Commentaires à mot-clé et nouveaux DM → leads (après la synchro des compteurs)
    const inbound   = syncDue ? await syncInbound() : [];
    // Commentaires de la Page Facebook → feuille Inbound (même rythme que la synchro Instagram)
    const facebook  = syncDue ? await syncFacebookComments() : null;
    const stale_uploads_removed = await cleanupStaleUploads();
    // Légendes manquantes, puis contenus prêts → prochains créneaux (si pilote automatique)
    // (une seule par passage, et seulement s'il reste du temps : limite de 60 s)
    const captioned      = published.length || Date.now() - started > 25_000 ? 0 : await captionMissing(1);
    const auto_scheduled = await autoScheduleDrafts();
    return NextResponse.json({ published, crossposted, backfilled, synced, inbound, facebook, stale_uploads_removed, captioned, auto_scheduled });
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
