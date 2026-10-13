import { supabase } from '@/lib/supabase';
import { accountEvent, type LinkedinSettings } from '@/lib/linkedin';
import { evaluateTier, planDay, parisClock, type Invite } from '@/lib/linkedinRamp';

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
  const day_plan = planDay({ ...s, tier }, today);
  await db.from('linkedin_settings').update({ tier, tier_since: tierSince, day_plan, tier_reason: ev.reason }).eq('id', 1);
  return { ...s, tier, tier_since: tierSince, day_plan };
}
