import { NextRequest, NextResponse } from 'next/server';
import { hasAgentKey } from '@/lib/emailingAuth';
import { nextTasks, getEmailSettings } from '@/lib/emailing';

// Hermès : prochains mails à envoyer (?limit=50). Chaque lead remis est réservé 6 h ; Hermès
// rapporte ensuite « sent » (ou rend le lead via /release en cas d'échec).
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  if (!hasAgentKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const limit = Math.max(1, Number(request.nextUrl.searchParams.get('limit')) || 50);
  const [res, s] = await Promise.all([nextTasks(limit), getEmailSettings()]);
  return NextResponse.json({ ...res, instructions: s.instructions });
}
