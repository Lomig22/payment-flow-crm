import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { igGet } from '@/lib/instagramGraph';

// Comptes Instagram connectés (admins) :
//  GET  → comptes (sans les jetons) : pseudo, expiration, dernière synchro
//  POST → { token } : jeton d'accès Instagram (connexion Instagram, généré dans l'app Meta),
//         vérifié auprès d'Instagram puis enregistré pour le compte auquel il appartient.
// Les données (contenus, file de publication, statistiques, leads inbound) sont rangées par compte.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const { data } = await (supabase as any).from('instagram_tokens')
    .select('account_username, expires_at, last_sync_at, last_sync_error').order('account_username');
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const { token } = await request.json().catch(() => ({}));
  const t = String(token ?? '').trim();
  if (t.length < 50) return badRequest('Jeton Instagram manquant ou incomplet');
  let me: { user_id: string; username: string; account_type?: string };
  try {
    me = await igGet('me', t, { fields: 'user_id,username,account_type' });
  } catch (e: any) {
    return badRequest(`Instagram refuse ce jeton : ${e.message}`);
  }
  if (me.account_type && !['BUSINESS', 'MEDIA_CREATOR'].includes(me.account_type)) {
    return badRequest(`@${me.username} est un compte personnel : passe-le en compte professionnel dans l'appli Instagram`);
  }
  const now = new Date();
  const { error } = await (supabase as any).from('instagram_tokens').upsert({
    account_username: me.username, ig_user_id: me.user_id, access_token: t,
    expires_at: new Date(now.getTime() + 60 * 86_400_000).toISOString(), refreshed_at: now.toISOString(),
    last_sync_error: null,   // reconnecté : l'alerte « jeton invalide » pourra repartir à la prochaine panne
  }, { onConflict: 'account_username' });
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ account_username: me.username });
}
