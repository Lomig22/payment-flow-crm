import { NextRequest, NextResponse } from 'next/server';
import { hasAgentKey } from '@/lib/emailingAuth';
import { emailStats } from '@/lib/emailing';

// Hermès : indicateurs de l'emailing (envois du jour, taux d'ouverture et de réponse sur 7 et 30 jours)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!hasAgentKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const { settings, by_status, rates, today, week, last_event_at } = await emailStats();
  return NextResponse.json({ active: settings.active, goal: settings.daily_goal, today, week, rates, by_status, last_event_at });
}
