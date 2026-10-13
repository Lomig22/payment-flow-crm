import { NextRequest, NextResponse } from 'next/server';
import { connectTikTok, verifyState } from '@/lib/tiktok';

// Retour de l'autorisation TikTok : enregistre les jetons puis renvoie vers la page Publication
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const p    = request.nextUrl.searchParams;
  const back = new URL('/instagram/publication', request.nextUrl.origin);
  if (p.get('error')) { back.searchParams.set('tiktok', `refus : ${p.get('error_description') ?? p.get('error')}`); return NextResponse.redirect(back); }
  if (!verifyState(p.get('state'))) { back.searchParams.set('tiktok', 'lien expiré, recommencez'); return NextResponse.redirect(back); }
  try {
    back.searchParams.set('tiktok', `connecté : ${await connectTikTok(p.get('code') ?? '')}`);
  } catch (e: any) {
    back.searchParams.set('tiktok', `erreur : ${e.message}`);
  }
  return NextResponse.redirect(back);
}
