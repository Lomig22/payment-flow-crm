import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { startOfTodayParis } from '@/lib/paris-time';
import { getEffectiveLimits } from '@/lib/igLimits';

// Clic « Follow » sur un lead de la piste follow (statut À follow) : le profil
// s'ouvre côté client, le follow est fait à la main ; ici on le compte (quota
// FOLLOW_DAILY_LIMIT/jour par compte d'envoi) et on passe le lead en « Follow envoyé ».
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const db = supabase as any;
  const { account_id } = await request.json().catch(() => ({}));
  if (!account_id) return badRequest('Sélectionne le compte depuis lequel tu follow');

  const { data: lead, error: fetchErr } = await db
    .from('leads').select('id, status, setter_id').eq('id', params.id).single();
  if (fetchErr || !lead) return notFound('Lead introuvable');
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();
  if (lead.status !== 'to_follow') {
    return NextResponse.json({ lead, counted: false });
  }

  const { data: acc } = await db
    .from('social_accounts').select('id, paused_until').eq('id', account_id).eq('platform', 'instagram').single();
  if (!acc) return badRequest('Compte d’envoi introuvable');
  if (acc.paused_until && new Date(acc.paused_until).getTime() > Date.now()) {
    return NextResponse.json(
      { message: `Compte au repos jusqu’au ${new Date(acc.paused_until).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}` },
      { status: 429 },
    );
  }

  const { count } = await db
    .from('instagram_dm_log')
    .select('id', { count: 'exact', head: true })
    .eq('action', 'follow').eq('account_id', acc.id)
    .gte('created_at', startOfTodayParis().toISOString());
  const lim = await getEffectiveLimits();
  if (lim.follows_per_day > 0 && (count ?? 0) >= lim.follows_per_day) {
    return NextResponse.json(
      { message: `Quota atteint : ${lim.follows_per_day} follows aujourd’hui sur ce compte` },
      { status: 429 },
    );
  }

  const { data: updated, error: updErr } = await db
    .from('leads')
    .update({ status: 'followed', followed_at: new Date().toISOString(), last_dm_account_id: acc.id })
    .eq('id', params.id).select('*').single();
  if (updErr) return NextResponse.json({ message: 'Sauvegarde échouée, réessayez' }, { status: 500 });

  await db.from('instagram_dm_log').insert({
    lead_id: params.id, account_id: acc.id, user_id: user.id,
    from_status: 'to_follow', to_status: 'followed', action: 'follow',
  });
  await db.from('lead_history').insert({
    lead_id: params.id, user_id: user.id, field_changed: 'status',
    old_value: 'to_follow', new_value: 'followed', action_note: 'Follow depuis le CRM',
  });

  return NextResponse.json({ lead: updated, counted: true, today: (count ?? 0) + 1 });
}
