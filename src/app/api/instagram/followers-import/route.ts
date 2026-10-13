import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { igProfileUrl, parseIgUsername } from '@/lib/instagram';

// Import des abonnés d'un compte (export officiel « Télécharger vos informations »
// d'Instagram : l'API ne donne pas la liste des abonnés). Chaque abonné récent passe
// en « Follow back » (DM à envoyer) depuis le compte suivi :
//   • inconnu → lead créé (inbound) ;
//   • lead au stade À follow / Follow envoyé / Lead → passe en Follow back ;
//   • lead déjà en conversation (M1, R1, réponse, RDV…) → inchangé.
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const PROMOTABLE = ['to_follow', 'followed', 'lead'];

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { account_username, followers, since } = await request.json();
  if (!account_username || !Array.isArray(followers)) return badRequest('Compte et abonnés requis');

  const db = supabase as any;
  const { data: accounts } = await db.from('social_accounts').select('id, username').eq('platform', 'instagram');
  const acc = (accounts ?? []).find((a: any) => a.username?.toLowerCase() === String(account_username).toLowerCase());
  if (!acc) return badRequest(`Compte @${account_username} introuvable dans les comptes Instagram du CRM`);
  const own = new Set((accounts ?? []).map((a: any) => a.username?.toLowerCase()));

  // Abonnés valides, récents, hors comptes de l'équipe, sans doublon
  const sinceMs = since ? Date.parse(since) : 0;
  const byName = new Map<string, string | null>();
  let tooOld = 0, excluded = 0;
  for (const f of followers.slice(0, 20000)) {
    const username = parseIgUsername(f?.username);
    if (!username) continue;
    if (own.has(username)) { excluded++; continue; }
    const at = f?.followed_at && !Number.isNaN(Date.parse(f.followed_at)) ? new Date(f.followed_at).toISOString() : null;
    if (sinceMs && at && Date.parse(at) < sinceMs) { tooOld++; continue; }
    if (!byName.has(username)) byName.set(username, at);
  }
  const names = Array.from(byName.keys());

  // Leads existants (par paquets : limite d'URL)
  const existing = new Map<string, { id: string; status: string }>();
  for (let i = 0; i < names.length; i += 300) {
    const { data } = await db.from('leads').select('id, status, instagram_username').in('instagram_username', names.slice(i, i + 300));
    for (const l of data ?? []) existing.set(String(l.instagram_username).toLowerCase(), l);
  }

  const now = new Date().toISOString();
  const toCreate: Record<string, unknown>[] = [];
  const toPromote: { id: string; status: string; at: string }[] = [];
  let inConversation = 0;
  for (const [username, at] of Array.from(byName.entries())) {
    const lead = existing.get(username);
    if (!lead) {
      toCreate.push({
        first_name: username, last_name: '—', instagram_username: username, instagram_url: igProfileUrl(username),
        source: 'instagram', status: 'followed_back', followed_back_at: at ?? now, action_in_progress: 'follow_up',
        last_dm_account_id: acc.id, origin: 'inbound', inbound_channel: 'other',
        notes: `S'est abonné à @${acc.username}${at ? ` le ${new Date(at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}` : ''}`,
      });
    } else if (PROMOTABLE.includes(lead.status)) {
      toPromote.push({ id: lead.id, status: lead.status, at: at ?? now });
    } else {
      inConversation++;
    }
  }

  let created = 0;
  for (let i = 0; i < toCreate.length; i += 200) {
    const { data, error } = await db.from('leads').insert(toCreate.slice(i, i + 200)).select('id');
    if (error) return NextResponse.json({ message: error.message, created }, { status: 500 });
    created += data?.length ?? 0;
    await db.from('lead_history').insert((data ?? []).map((l: any) => ({
      lead_id: l.id, user_id: user.id, action_note: `Abonné à @${acc.username} : importé en Follow back`,
    })));
  }

  for (const p of toPromote) {
    await db.from('leads').update({ status: 'followed_back', followed_back_at: p.at, last_dm_account_id: acc.id }).eq('id', p.id);
    await db.from('lead_history').insert({
      lead_id: p.id, user_id: user.id, field_changed: 'status', old_value: p.status, new_value: 'followed_back',
      action_note: `S'est abonné à @${acc.username}`,
    });
  }

  return NextResponse.json({ created, promoted: toPromote.length, in_conversation: inConversation, too_old: tooOld, excluded });
}
