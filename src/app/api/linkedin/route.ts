import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import {
  getLinkedinSettings, countToday, countInvitesWeek, inWorkingHours, invitesPerDay, linkedinSlug, liEvent, forecastInvites,
  accountEvent, weeklyCap, ACTIVE, MESSAGED,
} from '@/lib/linkedin';
import { acceptanceRate, type Invite } from '@/lib/linkedinRamp';
import { decide, doNotContact, normCompany } from '@/lib/linkedinFlow';

// Page LinkedIn (admins) :
//  GET  → réglages, état d'exécution, leads de la séquence, candidats, file « À valider », journal
//  PUT  → réglages
//  POST → { action, lead_ids | lead_id, message? } :
//         enqueue | remove | requeue | preview | handled | dnc | validate | edit | reject
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

async function guard(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return { error: unauthorized() };
  if (user.role !== 'admin') return { error: forbidden() };
  return { user };
}

const LEAD_FIELDS = 'li_inv_variant, li_open_profile, li_visited_at, id, first_name, last_name, company, job_title, li_sector, niche, linkedin_url, li_status, li_enqueued_at, li_invited_at, li_connected_at, li_dm_sent_at, li_last_sent_at, li_last_kind, li_due_at, li_variant, li_question, li_replied_at, li_replied_stage, li_reply_text, li_thread_url, li_handled_at, li_error, li_preview, li_expired_at, do_not_contact';

export async function GET(request: NextRequest) {
  const g = await guard(request); if (g.error) return g.error;
  const db = supabase as any;
  const [s, invitesToday, invitesWeek, messagesToday, { data: leads }, { data: candidates }, { data: review }, { data: log }] = await Promise.all([
    getLinkedinSettings(),
    countToday('invite'),
    countInvitesWeek(),
    countToday('message'),
    db.from('leads').select(LEAD_FIELDS).not('li_status', 'is', null).order('li_enqueued_at', { ascending: false, nullsFirst: false }).limit(3000),
    db.from('leads').select('id, first_name, last_name, company, job_title, li_sector, linkedin_url, created_at')
      .is('li_status', null).eq('do_not_contact', false).not('linkedin_url', 'is', null).neq('linkedin_url', '')
      .order('created_at', { ascending: false }).limit(2000),
    db.from('leads').select('id, first_name, last_name, company, job_title, linkedin_url, li_status, li_preview, li_pending, li_profile_at')
      .not('li_pending', 'is', null).or('li_status.eq.to_validate,li_preview.eq.true').limit(200),
    db.from('linkedin_log').select('id, lead_id, action, result, detail, stage, created_at, leads(first_name, last_name)')
      .order('created_at', { ascending: false }).limit(40),
  ]);
  if (!s) return NextResponse.json({ message: 'Réglages LinkedIn introuvables' }, { status: 500 });

  const now = new Date();
  const execution = {
    state: s.account_state === 'blocked' || s.stop_reason ? 'stopped' : s.account_state === 'cooldown' ? 'cooldown' : !s.enabled ? 'paused' : !inWorkingHours(s, now) ? 'outside' : 'active',
    reason: s.account_state === 'blocked' || s.stop_reason ? (s.stop_reason ?? 'compte bloqué')
      : s.account_state === 'cooldown' ? `Cooldown jusqu'au ${s.cooldown_until ? new Date(s.cooldown_until).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'medium', timeStyle: 'short' }) : '—'}`
      : !s.enabled ? 'Séquence désactivée' : !inWorkingHours(s, now) ? 'Hors fenêtre des invitations : les messages, acceptations et réponses continuent' : null,
    invites_today: invitesToday, invites_per_day: invitesPerDay(s, now), ramp_week: s.tier,
    invites_week: invitesWeek, weekly_cap: weeklyCap(s),
    messages_today: messagesToday, messages_per_day: s.dms_per_day,
    worker_seen_at: s.last_seen_at,
    next_action_at: s.next_action_at,
  };

  // Prévision des invitations (jour par jour) pour la file « en séquence »
  const { data: recentInvites } = await db.from('linkedin_log').select('created_at')
    .eq('action', 'invite').eq('result', 'ok').gte('created_at', new Date(now.getTime() - 7 * 86_400_000).toISOString());
  const dayKey = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const perDay = new Map<string, number>();
  for (const r of recentInvites ?? []) perDay.set(dayKey(new Date(r.created_at)), (perDay.get(dayKey(new Date(r.created_at))) ?? 0) + 1);
  const last6 = [6, 5, 4, 3, 2, 1].map((k) => perDay.get(dayKey(new Date(now.getTime() - k * 86_400_000))) ?? 0);
  const queued = (leads ?? []).filter((l: any) => l.li_status === 'to_invite')
    .sort((a: any, b: any) => String(a.li_enqueued_at).localeCompare(String(b.li_enqueued_at)) || a.id.localeCompare(b.id))
    .map((l: any) => l.id);
  const forecast = forecastInvites(s, queued, invitesToday, last6, now);
  for (const l of leads ?? []) if (forecast.has(l.id)) l.invite_forecast = forecast.get(l.id)!.toISOString();

  // Montée en charge : taux d'acceptation et de réponse, par variante d'invitation et par secteur
  const all = (leads ?? []) as any[];
  const inv = (ls: any[]): Invite[] => ls.filter((l) => l.li_invited_at).map((l) => ({ invited_at: l.li_invited_at, connected_at: l.li_connected_at }));
  const rates = (ls: any[]) => {
    const sent = ls.filter((l) => l.li_dm_sent_at);
    return {
      accept_7: acceptanceRate(inv(ls), now, 0, 7), accept_30: acceptanceRate(inv(ls), now, 0, 30),
      accept_mature: acceptanceRate(inv(ls), now, 7, 21),
      reply: { sent: sent.length, replied: sent.filter((l) => l.li_replied_at && l.li_replied_stage).length },
    };
  };
  const groups = (key: string) => Object.fromEntries(Array.from(new Set(all.map((l) => l[key]).filter(Boolean))).map((k) => [k, rates(all.filter((l) => l[key] === k))]));
  const { data: events } = await db.from('linkedin_events').select('id, type, detail, created_at').order('created_at', { ascending: false }).limit(40);
  const ramp = {
    tier: s.tier, tiers: s.tiers, tier_since: s.tier_since, tier_reason: (s as any).tier_reason ?? null,
    plan: s.day_plan, account_state: s.account_state, cooldown_until: s.cooldown_until,
    weekly_cap: weeklyCap(s), invites_week: invitesWeek, invites_today: invitesToday,
    pending_count: s.pending_count, pending_count_at: s.pending_count_at, pending_cap: s.pending_cap, pending_suspend: s.pending_suspend,
    overall: rates(all), by_variant: groups('li_inv_variant'), by_sector: groups('li_sector'),
    open_profiles: all.filter((l) => l.li_open_profile).length,
    previsited: all.filter((l) => l.li_status === 'to_invite' && l.li_visited_at).length,
    worker: { id: s.worker_id, ip: s.worker_ip, proxy: s.worker_proxy, ips: s.worker_ips ?? [] },
    events: events ?? [],
  };

  // Préparation en cours (aperçus) : profil pas encore visité
  const { count: previewWaiting } = await db.from('leads').select('id', { count: 'exact', head: true })
    .eq('li_preview', true).is('li_pending', null);

  return NextResponse.json({
    settings: s, execution, ramp,
    leads: leads ?? [],
    candidates: (candidates ?? []).filter((l: any) => linkedinSlug(l.linkedin_url)),
    review: (review ?? []).sort((a: any, b: any) => String(a.li_pending?.generated_at).localeCompare(String(b.li_pending?.generated_at))),
    preview_waiting: previewWaiting ?? 0,
    log: log ?? [],
  });
}

const int = (min: number, max: number) => (v: any) => Number.isInteger(v) && v >= min && v <= max;
const EDITABLE: Record<string, (v: any) => boolean> = {
  enabled:             (v) => typeof v === 'boolean',
  weekdays_only:       (v) => typeof v === 'boolean',
  manual_validation:   (v) => typeof v === 'boolean',
  work_start_hour:     int(0, 23),
  work_end_hour:       int(1, 24),
  min_gap_minutes:     int(1, 120),
  max_gap_minutes:     int(1, 240),
  ramp:                (v) => Array.isArray(v) && v.length >= 1 && v.length <= 8 && v.every(int(0, 40)),
  weekly_invite_cap:   int(0, 200),
  dms_per_day:         int(0, 60),
  invite_expiry_days:  int(3, 60),
  first_msg_min_hours: int(0, 72),
  first_msg_max_hours: int(1, 96),
  r1_days:             int(1, 30),
  r2_days:             int(1, 45),
  r3_days:             int(1, 60),
  end_days:            int(1, 30),
  inbox_every_minutes: int(10, 240),
  validation_target:   int(0, 500),
  // Montée en charge (sprint46)
  tiers:               (v) => Array.isArray(v) && v.length >= 1 && v.length <= 8 && v.every((t: any) => Number.isInteger(t?.min) && Number.isInteger(t?.max) && t.min >= 1 && t.max >= t.min && t.max <= 60),
  promote_min_days:    int(1, 60),
  promote_rate:        int(1, 100),
  promote_rate_last:   int(1, 100),
  demote_rate:         int(0, 100),
  rate_min_sample:     int(1, 200),
  last_tier_bonus_pct: int(0, 100),
  volume_jitter_pct:   int(0, 50),
  day_start_min:       int(0, 1439),
  day_end_min:         int(1, 1440),
  lunch_start_min:     int(0, 1439),
  lunch_end_min:       int(0, 1440),
  invite_gap_min:      int(1, 60),
  invite_gap_max:      int(1, 120),
  sessions_min:        int(1, 3),
  sessions_max:        int(1, 3),
  cooldown_days:       int(1, 60),
  cooldown_tier_drop:  int(0, 8),
  error_streak_max:    int(2, 50),
  pending_cap:         int(100, 5000),
  pending_suspend:     int(50, 5000),
  reinvite_block_days: int(0, 365),
  note_split_pct:      int(0, 100),
  note_templates:      (v) => v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((t) => typeof t === 'string' && t.length <= 200),
  previsit_enabled:    (v) => typeof v === 'boolean',
};

export async function PUT(request: NextRequest) {
  const g = await guard(request); if (g.error) return g.error;
  const body = await request.json().catch(() => ({}));
  const db = supabase as any;

  // Forcer un palier : vers le bas uniquement
  if (body.force_tier !== undefined) {
    const cur = await getLinkedinSettings();
    if (!cur || !Number.isInteger(body.force_tier) || body.force_tier < 1 || body.force_tier >= cur.tier) return badRequest('Seul un palier inférieur au palier actuel peut être forcé');
    await db.from('linkedin_settings').update({ tier: body.force_tier, tier_since: new Date().toISOString(), day_plan: null }).eq('id', 1);
    await accountEvent('tier_forced', `Palier forcé à ${body.force_tier} (au lieu de ${cur.tier}) depuis /linkedin`);
    return NextResponse.json({ ok: true });
  }
  // Débloquer après un captcha / une vérification / une déconnexion réglés à la main
  if (body.unblock === true) {
    await db.from('linkedin_settings').update({ account_state: 'active', stop_reason: null, stopped_at: null, alert: null, alert_at: null, error_streak: 0, next_action_at: null }).eq('id', 1);
    await accountEvent('unblocked', 'Compte débloqué manuellement depuis /linkedin');
    return NextResponse.json({ ok: true });
  }
  const updates: Record<string, unknown> = {};
  for (const [field, valid] of Object.entries(EDITABLE)) {
    if (body[field] === undefined) continue;
    if (!valid(body[field])) return badRequest(`Valeur invalide : ${field}`);
    updates[field] = body[field];
  }
  if (!Object.keys(updates).length) return badRequest('Aucun réglage');
  const s = await getLinkedinSettings();
  const minGap = (updates.min_gap_minutes ?? s?.min_gap_minutes) as number, maxGap = (updates.max_gap_minutes ?? s?.max_gap_minutes) as number;
  if (maxGap < minGap) return badRequest('L\'intervalle maximum doit être supérieur au minimum');
  if ((updates.invite_gap_max as number ?? s?.invite_gap_max) < (updates.invite_gap_min as number ?? s?.invite_gap_min)) return badRequest('Délai maximum entre invitations inférieur au minimum');
  if ((updates.sessions_max as number ?? s?.sessions_max) < (updates.sessions_min as number ?? s?.sessions_min)) return badRequest('Nombre de sessions : maximum inférieur au minimum');
  // Paramètres du jour modifiés : le plan du jour est recalculé au prochain passage
  if (['tiers', 'volume_jitter_pct', 'sessions_min', 'sessions_max', 'day_start_min', 'day_end_min', 'lunch_start_min', 'lunch_end_min'].some((k) => k in updates)) updates.day_plan = null;
  if (updates.enabled === true && !s?.ramp_started_at) updates.ramp_started_at = new Date().toISOString();
  updates.updated_at = new Date().toISOString();
  const { data, error } = await (supabase as any).from('linkedin_settings').update(updates).eq('id', 1).select().single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function POST(request: NextRequest) {
  const g = await guard(request); if (g.error) return g.error;
  const body = await request.json().catch(() => ({}));
  const { action } = body;
  const db  = supabase as any;
  const now = new Date().toISOString();

  // Actions sur un seul lead
  if (['validate', 'edit', 'reject', 'dnc'].includes(action)) {
    if (!body.lead_id) return badRequest('lead_id requis');
    if (action === 'dnc') return NextResponse.json({ excluded: await doNotContact(body.lead_id) });
    const r = await decide(body.lead_id, action, body.message);
    return r.error ? badRequest(r.error) : NextResponse.json({ ok: true });
  }

  const ids: string[] = Array.isArray(body.lead_ids) ? body.lead_ids : [];
  if (!ids.length) return badRequest('lead_ids requis');

  if (action === 'enqueue') {
    // Prénom et URL exploitables, pas déjà dans la séquence, pas « ne plus contacter », une seule entreprise à la fois
    const { data } = await db.from('leads').select('id, first_name, company, linkedin_url, li_status, do_not_contact, li_expired_at').in('id', ids);
    const { data: active } = await db.from('leads').select('company').in('li_status', ACTIVE);
    const busy = new Set((active ?? []).map((l: any) => normCompany(l.company)).filter(Boolean));
    const ok: string[] = [];
    for (const l of data ?? []) {
      // Jamais réinvité : une invitation déjà ignorée (expirée ou retirée) exclut le lead
      if (l.li_status || l.do_not_contact || l.li_expired_at || !linkedinSlug(l.linkedin_url) || !(l.first_name ?? '').trim()) continue;
      const k = normCompany(l.company);
      if (k && busy.has(k)) continue;
      if (k) busy.add(k);
      ok.push(l.id);
    }
    if (ok.length) {
      await db.from('leads').update({ li_status: 'to_invite', li_enqueued_at: now, li_attempts: 0, li_error: null }).in('id', ok);
      await db.from('lead_history').insert(ok.map((id) => ({ lead_id: id, field_changed: 'li_status', new_value: 'En séquence', action_note: 'LinkedIn : ajouté à la séquence' })));
    }
    return NextResponse.json({ enqueued: ok.length, skipped: ids.length - ok.length });
  }

  if (action === 'preview') {
    // Test de qualité : profil visité et message rédigé, jamais envoyé (15 leads max à la fois)
    const { data } = await db.from('leads').select('id, li_status, linkedin_url, do_not_contact').in('id', ids.slice(0, 15));
    const ok = (data ?? []).filter((l: any) => !l.do_not_contact && linkedinSlug(l.linkedin_url) && ![...MESSAGED, 'to_validate', 'ready', 'to_resume'].includes(l.li_status)).map((l: any) => l.id);
    if (ok.length) await db.from('leads').update({ li_preview: true, li_pending: null }).in('id', ok);
    return NextResponse.json({ previewing: ok.length });
  }

  if (action === 'handled') {
    await db.from('leads').update({ li_handled_at: now }).in('id', ids).eq('li_status', 'to_resume');
    return NextResponse.json({ ok: true });
  }

  if (action === 'requeue') {
    // Lead en erreur : il repart de l'étape où il s'était arrêté (jamais de second premier message)
    const { data } = await db.from('leads').select('id, li_pending, li_invited_at, li_connected_at, li_dm_sent_at, li_last_kind').in('id', ids).eq('li_status', 'failed');
    for (const l of data ?? []) {
      const li_status = l.li_pending ? 'ready'
        : l.li_dm_sent_at ? ({ first: 'first_sent', r1: 'r1_sent', r2: 'r2_sent', r3: 'r3_sent' } as Record<string, string>)[l.li_last_kind] ?? 'first_sent'
        : l.li_connected_at ? 'connected' : l.li_invited_at ? 'invited' : 'to_invite';
      await db.from('leads').update({ li_status, li_attempts: 0, li_error: null }).eq('id', l.id);
      await liEvent(l.id, 'failed', li_status, 'remis dans la séquence');
    }
    return NextResponse.json({ requeued: (data ?? []).length });
  }

  if (action === 'remove') {
    // Hors séquence (le profil lu et l'historique restent)
    await db.from('leads').update({
      li_status: null, li_enqueued_at: null, li_invited_at: null, li_connected_at: null, li_dm_sent_at: null,
      li_due_at: null, li_pending: null, li_msg: null, li_variant: null, li_question: null, li_replied_stage: null,
      li_last_sent_at: null, li_last_kind: null, li_preview: false, li_attempts: 0, li_error: null,
    }).in('id', ids).not('li_status', 'in', `(${[...MESSAGED, 'to_resume', 'no_reply', 'dnc'].join(',')})`);
    return NextResponse.json({ ok: true });
  }

  return badRequest('action invalide');
}
