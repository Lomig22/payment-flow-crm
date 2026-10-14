import { NextRequest, NextResponse } from 'next/server';
import { hasAgentKey } from '@/lib/emailingAuth';
import { recordEvents } from '@/lib/emailing';

// Hermès : événements (sent, opened, clicked, replied, bounced, unsubscribed, interested,
// not_interested, note), un objet ou { events: [...] } (500 au plus). Idempotent par message_id + type.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!hasAgentKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const events = Array.isArray(body?.events) ? body.events : body ? [body] : [];
  if (!events.length || events.length > 500) return NextResponse.json({ message: '1 à 500 événements attendus' }, { status: 400 });
  return NextResponse.json(await recordEvents(events));
}
