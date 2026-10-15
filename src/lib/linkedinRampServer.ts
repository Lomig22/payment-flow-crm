import { supabase } from '@/lib/supabase';
import { accountEvent, countToday, countInvitesWeek, type LinkedinSettings } from '@/lib/linkedin';
import { evaluateTier, planDay, parisClock, scheduleSlots, weeklyCap, type Invite } from '@/lib/linkedinRamp';

// Montée en charge (sprint46), partie base de données : une fois par jour, évaluation du palier
// (taux d'acceptation, incidents) puis plan du jour (cible ±20 %, 2 ou 3 sessions).

const DAY = 86_400_000;

export async function recentInvites(days = 30): Promise<Invite[]> {
  const { data } = await (supabase as any).from('leads').select('li_invited_at, li_connected_at')
    .not('li_invited_at', 'is', null).gte('li_invited_at', new Date(Date.now() - days * DAY).toISOString()).limit(5000);
  return (data ?? []).map((l: any) => ({ invited_at: l.li_invited_at, connected_at: l.li_connected_at }));
}

export async function ensureDayPlan(s: LinkedinSettings, now = new Date()): Promise<LinkedinSettings> {
  const today = parisClock(now).date;
  if (s.day_plan?.date === today) return s;
  const db = supabase as any;
  let tier = s.tier, tierSince = s.tier_since ?? now.toISOString();
  const { count: incidents } = await db.from('linkedin_events').select('id', { count: 'exact', head: true })
    .in('type', ['cooldown', 'blocked']).gte('created_at', tierSince);
  const ev = evaluateTier({ ...s, tier_since: tierSince }, await recentInvites(30), (incidents ?? 0) > 0, now);
  if (ev.action !== 'stay') {
    tier = ev.action === 'up' ? s.tier + 1 : s.tier - 1;
    tierSince = now.toISOString();
    await accountEvent(ev.action === 'up' ? 'tier_up' : 'tier_down', `Palier ${s.tier} → ${tier} : ${ev.reason}`, {
      subject: `palier ${tier}`,
      lines: [`Montée en charge LinkedIn : passage du palier ${s.tier} au palier ${tier} (${s.tiers[tier - 1].min}–${s.tiers[tier - 1].max} invitations par jour).`, `Raison : ${ev.reason}.`],
    });
  }
  const day_plan = planDay({ ...s, tier }, today, Math.random, undefined, parisClock(now).minutes);
  await db.from('linkedin_settings').update({ tier, tier_since: tierSince, day_plan, tier_reason: ev.reason }).eq('id', 1);
  return { ...s, tier, tier_since: tierSince, day_plan };
}

// Horaires exacts des invitations du jour (plan.slots) : on retire les leads déjà invités ou sortis
// de la file, puis on planifie à la suite autant de leads que la cible du jour le permet. Le worker
// envoie chaque invitation à son heure ; le pipeline affiche cette heure.
export async function ensureInviteSlots(s: LinkedinSettings, now = new Date()): Promise<LinkedinSettings> {
  const plan = s.day_plan;
  const clock = parisClock(now);
  if (!plan || plan.date !== clock.date) return s;
  const db = supabase as any;
  const slots = plan.slots ?? [];
  const { data: live } = slots.length
    ? await db.from('leads').select('id').in('id', slots.map((x) => x.lead_id)).eq('li_status', 'to_invite').eq('do_not_contact', false)
    : { data: [] };
  const liveIds = new Set((live ?? []).map((l: any) => l.id));
  const pending = slots.filter((x) => liveIds.has(x.lead_id));
  const [sentToday, sentWeek] = await Promise.all([countToday('invite'), countInvitesWeek()]);
  const want = Math.min(plan.target - sentToday, weeklyCap(s) - sentWeek) - pending.length;
  let added: { lead_id: string; at: string }[] = [];
  if (want > 0) {
    // Même ordre que l'envoi : leads visités d'abord, puis les plus anciens de la file ; jamais réinvité
    const { data: cands } = await db.from('leads').select('id')
      .eq('li_status', 'to_invite').eq('do_not_contact', false).is('li_expired_at', null)
      .order('li_visited_at', { ascending: true, nullsFirst: false }).order('li_enqueued_at', { ascending: true, nullsFirst: false })
      .limit(want + pending.length);
    const ids = (cands ?? []).map((l: any) => l.id).filter((id: string) => !liveIds.has(id)).slice(0, want);
    added = scheduleSlots(s, plan, pending, ids, now, clock.minutes);
  }
  if (!added.length && pending.length === slots.length) return s;
  const day_plan = { ...plan, slots: [...pending, ...added] };
  await db.from('linkedin_settings').update({ day_plan }).eq('id', 1);
  return { ...s, day_plan };
}
