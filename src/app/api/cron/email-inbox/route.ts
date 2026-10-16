import { NextRequest, NextResponse } from 'next/server';
import { hasCronKey } from '@/lib/cronAuth';
import { checkInbox } from '@/lib/emailInbox';

// Réponses aux mails de prospection : lecture de la boîte d'envoi (IMAP), appelé toutes les 10 min par
// le VPS. Protégé par CRON_SECRET.
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  return NextResponse.json(await checkInbox());
}
