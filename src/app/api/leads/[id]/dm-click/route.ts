import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { startOfTodayParis } from '@/lib/paris-time';
import { getEffectiveLimits } from '@/lib/igLimits';

// Clic sur le @ d'un lead Instagram/Facebook (ouverture des DM) :
//  • avance le lead d'une étape de message : Lead → M1 envoyé → R1 → R2
//    (les autres statuts — réponse, relance, audit, RDV, non qualifié — ne
//    bougent pas : ouvrir les DM pour répondre ne doit rien rétrograder) ;
//  • horodate l'étape (m1_date / r1_date / r2_date) ;
//  • mémorise le compte d'envoi sélectionné et journalise le DM (compteurs).
// Un envoi de prospection (étape qui avance) est soumis aux sécurités du compte :
// compte au repos, délai minimum entre deux DM, plafonds horaire et journalier.
const NEXT_STATUS: Record<string, { status: string; dateField: string }> = {
  lead:          { status: 'm1', dateField: 'm1_date' },
  // piste follow : on ne DM qu'après le follow back
  followed_back: { status: 'm1', dateField: 'm1_date' },
  m1:            { status: 'r1', dateField: 'r1_date' },
  r1:            { status: 'r2', dateField: 'r2_date' },
};

const tooMany = (message: string) => NextResponse.json({ message }, { status: 429 });

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const db = supabase as any;
  const { account_id, variant } = await request.json().catch(() => ({}));

  const { data: lead, error: fetchErr } = await db
    .from('leads').select('id, status, setter_id, source').eq('id', params.id).single();
  if (fetchErr || !lead) return notFound('Lead introuvable');
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();

  let accountId: string | null = null;
  let pausedUntil: string | null = null;
  if (account_id) {
    const { data: acc } = await db
      .from('social_accounts').select('id, paused_until').eq('id', account_id).eq('platform', 'instagram').single();
    accountId   = acc?.id ?? null;
    pausedUntil = acc?.paused_until ?? null;
  }

  const next = NEXT_STATUS[lead.status];
  const now  = Date.now();

  if (next) {
    if (!accountId) return badRequest('Sélectionne le compte depuis lequel tu envoies le DM');
    if (pausedUntil && new Date(pausedUntil).getTime() > now) {
      return tooMany(`Compte au repos jusqu’au ${new Date(pausedUntil).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })}`);
    }
    const dayStart  = startOfTodayParis().getTime();
    const hourStart = now - 3_600_000;
    const { data: logs } = await db
      .from('instagram_dm_log')
      .select('from_status, to_status, created_at')
      .eq('account_id', accountId).eq('action', 'dm')
      .gte('created_at', new Date(Math.min(dayStart, hourStart)).toISOString())
      .order('created_at', { ascending: false }).limit(2000);
    const sends = (logs ?? [])
      .filter((r: any) => r.from_status !== r.to_status)
      .map((r: any) => new Date(r.created_at).getTime());

    // Limites réglées par un admin (0 = pas de limite ; aucune pendant une suspension)
    const lim  = await getEffectiveLimits();
    const wait = sends.length && lim.dm_interval_sec ? lim.dm_interval_sec - Math.floor((now - sends[0]) / 1000) : 0;
    if (wait > 0) return tooMany(`Trop rapide : attends encore ${wait} s avant le prochain DM`);
    if (lim.dm_per_hour > 0 && sends.filter((t: number) => t >= hourStart).length >= lim.dm_per_hour) {
      return tooMany(`Limite atteinte : ${lim.dm_per_hour} DM par heure sur ce compte`);
    }
    if (lim.dm_per_day > 0 && sends.filter((t: number) => t >= dayStart).length >= lim.dm_per_day) {
      return tooMany(`Limite atteinte : ${lim.dm_per_day} DM aujourd’hui sur ce compte`);
    }
  }

  const updates: Record<string, unknown> = { last_dm_account_id: accountId };
  if (next) {
    updates.status = next.status;
    updates[next.dateField] = new Date(now).toISOString();
  }

  const { data: updated, error: updErr } = await db
    .from('leads').update(updates).eq('id', params.id).select('*').single();
  if (updErr) return NextResponse.json({ message: 'Sauvegarde échouée, réessayez' }, { status: 500 });

  await db.from('instagram_dm_log').insert({
    lead_id: params.id, account_id: accountId, user_id: user.id,
    from_status: lead.status, to_status: next?.status ?? lead.status,
    variant: typeof variant === 'string' ? variant.slice(0, 20) : null,
  });
  if (next) {
    await db.from('lead_history').insert({
      lead_id: params.id, user_id: user.id, field_changed: 'status',
      old_value: lead.status, new_value: next.status,
      action_note: 'DM ouvert depuis le CRM',
    });
  }

  return NextResponse.json({ lead: updated, advanced: !!next });
}
