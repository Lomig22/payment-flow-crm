import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { syncInstagramContent } from '@/lib/instagramGraph';
import { syncInbound } from '@/lib/instagramInbound';

// Synchro manuelle du contenu Instagram (bouton « Synchroniser » de la page Contenu).
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  try {
    const synced  = await syncInstagramContent();
    const inbound = await syncInbound();
    // Les erreurs de captation remontent avec celles de la synchro (même format)
    return NextResponse.json(synced.map((s) => {
      const i = inbound.find((x) => x.account === s.account);
      return i ? { ...s, errors: [...s.errors, ...i.errors], inbound_leads: i.leads } : s;
    }));
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  }
}
