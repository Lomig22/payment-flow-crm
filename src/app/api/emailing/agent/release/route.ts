import { NextRequest, NextResponse } from 'next/server';
import { hasAgentKey } from '@/lib/emailingAuth';
import { releaseTasks } from '@/lib/emailing';

// Hermès : leads remis mais non envoyés (échec, boîte saturée) → disponibles de nouveau
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!hasAgentKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const { lead_ids } = await request.json().catch(() => ({}));
  if (!Array.isArray(lead_ids)) return NextResponse.json({ message: 'lead_ids attendu' }, { status: 400 });
  await releaseTasks(lead_ids.slice(0, 500).map(String));
  return NextResponse.json({ ok: true });
}
