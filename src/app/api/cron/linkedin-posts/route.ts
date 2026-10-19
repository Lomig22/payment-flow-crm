import { NextRequest, NextResponse } from 'next/server';
import { fillPosts, remindReconnect } from '@/lib/linkedinPosts';

// Posts LinkedIn : complète le stock (7 jours d'avance, 4 posts par passage) et rappelle de reconnecter
// le profil avant l'expiration. Appelé toutes les heures par le VPS (/opt/pf-cron/publish.sh).
// La publication à l'heure passe par /api/cron/publish-tick (chaque minute).
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret || request.headers.get('authorization') !== `Bearer ${secret}`) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  try {
    await remindReconnect();
    return NextResponse.json(await fillPosts());
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
