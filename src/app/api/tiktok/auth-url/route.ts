import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { tiktokAuthUrl } from '@/lib/tiktok';

// Lien de connexion du compte TikTok (bouton « Connecter TikTok » de la page Publication)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  if (!process.env.TIKTOK_CLIENT_KEY) return NextResponse.json({ message: 'TIKTOK_CLIENT_KEY non configurée' }, { status: 500 });
  return NextResponse.json({ url: tiktokAuthUrl() });
}
