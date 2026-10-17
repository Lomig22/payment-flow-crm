import { NextRequest, NextResponse } from 'next/server';
import { hasCronKey } from '@/lib/cronAuth';
import { computeSiteRecos } from '@/lib/emailReco';

// Recommandations sur les sites des prospects (variable {recommandations}) : un lot par appel, appelé
// par le cron du VPS tant qu'il en reste. Protégé par CRON_SECRET.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  return NextResponse.json(await computeSiteRecos(Number(request.nextUrl.searchParams.get('limit')) || 10));
}
