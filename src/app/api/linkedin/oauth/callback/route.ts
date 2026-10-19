import { NextRequest, NextResponse } from 'next/server';
import { checkState, exchangeCode } from '@/lib/linkedinPosts';

// Retour de LinkedIn après l'autorisation : enregistre la connexion, puis retour sur la page Posts LinkedIn.
// Le paramètre state (signé, valable 30 min) prouve que la demande vient du CRM.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const p = request.nextUrl.searchParams;
  const back = (q: string) => NextResponse.redirect(new URL(`/linkedin/posts?${q}`, request.nextUrl.origin));
  if (p.get('error')) return back(`linkedin_error=${encodeURIComponent(p.get('error_description') ?? p.get('error') ?? '')}`);
  if (!checkState(p.get('state')) || !p.get('code')) return back('linkedin_error=Lien%20expir%C3%A9%2C%20recommence');
  try {
    await exchangeCode(p.get('code')!);
    return back('connected=1');
  } catch (e: any) {
    return back(`linkedin_error=${encodeURIComponent(e.message)}`);
  }
}
