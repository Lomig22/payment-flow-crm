import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { authUrl } from '@/lib/linkedinPosts';

// Connexion du profil LinkedIn de Lomig (posts automatiques) : renvoie l'adresse d'autorisation LinkedIn
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  return NextResponse.json({ url: authUrl() });
}
