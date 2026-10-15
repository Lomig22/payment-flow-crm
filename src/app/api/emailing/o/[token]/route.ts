import { NextRequest, NextResponse } from 'next/server';
import { readToken } from '@/lib/emailTracking';
import { recordEvents } from '@/lib/emailing';

// Pixel d'ouverture des mails (public) : enregistre l'ouverture, renvoie une image transparente
export const dynamic = 'force-dynamic';
const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

export async function GET(_request: NextRequest, { params }: { params: { token: string } }) {
  const t = readToken(params.token);
  if (t) await recordEvents([{ lead_id: t.leadId, type: 'opened', step: t.step }]).catch(() => null);
  return new NextResponse(GIF, { headers: { 'Content-Type': 'image/gif', 'Cache-Control': 'no-store, no-cache, must-revalidate, private' } });
}
