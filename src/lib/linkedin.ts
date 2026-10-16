import { NextRequest } from 'next/server';
import { setTemplates, setRelances } from '@/lib/linkedinTemplates';
import { MESSAGED_STATUSES, relancesOf, type Relance } from '@/lib/linkedinSequence';
import { supabase } from '@/lib/supabase';
import { startOfTodayParis } from '@/lib/paris-time';
import { sendLeadEmail } from '@/lib/mailer';
import { LI_STATUS_LABELS, type Question } from '@/lib/linkedinLabels';
import {
  inActivityWindow, cooldownOutcome, weeklyCap, tierOf, parisClock, type RampSettings, type DayPlan, type AccountState,
} from '@/lib/linkedinRamp';

export { LI_STATUS_LABELS, SECTORS, QUESTION_LABELS, STAGE_LABELS } from '@/lib/linkedinLabels';
export type { Question, Stage } from '@/lib/linkedinLabels';

// Séquence LinkedIn v2 (sprint44, cahier des charges de Lomig du 12/10/2026) :
// invitation sans note → acceptation (lecture des relations) → visite du profil → premier message
// rédigé par l'agent (variante A post / B profil / C modèle) → validation manuelle des 50 premiers →
// relances R1 / R2 / R3 (ou relance « post ») → « sans réponse ». Arrêt à la première réponse.
// Le CRM décide de la prochaine action ; le worker du VPS l'exécute sur la session LinkedIn de
// Lomig puis rend compte (voir /api/linkedin/ext/*). Hermès ne touche jamais à LinkedIn.

export interface LinkedinSettings extends RampSettings {
  enabled:             boolean;
  ext_key:             string;
  dms_per_day:         number;       // messages par jour (premiers messages + relances)
  work_start_hour:     number;
  work_end_hour:       number;
  weekdays_only:       boolean;
  min_gap_minutes:     number;       // intervalle aléatoire entre deux actions
  max_gap_minutes:     number;
  ramp:                number[];     // invitations par jour, semaine 1, 2, 3, puis ensuite
  ramp_started_at:     string | null;
  weekly_invite_cap:   number;       // plafond sur 7 jours glissants
  invite_expiry_days:  number;
  first_msg_min_hours: number;
  first_msg_max_hours: number;
  r1_days:             number;       // jours ouvrés après le premier message
  r2_days:             number;
  r3_days:             number;
  end_days:            number;       // jours ouvrés après R3 avant « sans réponse »
  inbox_every_minutes: number;
  manual_validation:   boolean;
  validation_target:   number;
  validated_count:     number;
  next_action_at:      string | null;
  last_scan_at:        string | null;
  last_inbox_at:       string | null;
  last_seen_at:        string | null;
  alert:               string | null;
  alert_at:            string | null;
  stop_reason:         string | null;
  stopped_at:          string | null;
  last_question:       string | null;
  // Montée en charge intelligente (sprint46)
  day_plan:            DayPlan | null;
  account_state:       AccountState;
  cooldown_until:      string | null;
  error_streak:        number;
  error_streak_max:    number;
  pending_cap:         number;
  pending_suspend:     number;
  pending_count:       number | null;
  pending_count_at:    string | null;
  reinvite_block_days: number;
  note_split_pct:      number;
  note_templates:      Record<string, string>;
  msg_templates?:      Record<string, string>;   // gabarits des messages (onglet Messages)
  relances?:           Relance[];                // R1 … R16 : délai et textes (onglet Messages)
  previsit_enabled:    boolean;
  worker_id:           string | null;
  worker_ip:           string | null;
  worker_proxy:        boolean | null;
  worker_ips:          { ip: string; at: string }[];
}

// Statuts où un message est déjà parti : on surveille la messagerie
export const MESSAGED = MESSAGED_STATUSES;   // premier message, R1 … R16
// Statuts « en cours » : le lead ne doit pas être réimporté ni remis dans la séquence
export const ACTIVE = ['to_invite', 'invited', 'connected', 'to_validate', 'ready', ...MESSAGED];

export const LI_CONNECTIONS_URL = 'https://www.linkedin.com/mynetwork/invite-connect/connections/';
export const LI_INBOX_URL       = 'https://www.linkedin.com/messaging/';
// Une acceptation est repérée en relisant la page « Relations » (triée par date d'ajout)
// Toutes les 15 minutes, et dès la première action de la journée (14/10/2026 : des acceptations de
// la soirée n'étaient lues que le lendemain midi). LinkedIn n'offre ni API ni notification en temps
// réel pour un compte personnel : la page « Relations » est relue.
export const SCAN_EVERY_MS = 15 * 60_000;
// Au-delà, une erreur passe le lead en « failed » (sinon il est retenté plus tard)
export const MAX_ATTEMPTS = 3;
// Un profil lu il y a moins de 30 jours n'est pas revisité (une seule visite par lead)
export const PROFILE_FRESH_MS = 30 * 86_400_000;

export async function getLinkedinSettings(): Promise<LinkedinSettings | null> {
  const { data } = await (supabase as any).from('linkedin_settings').select('*').eq('id', 1).maybeSingle();
  setTemplates(data?.msg_templates);   // gabarits de messages modifiés par Lomig (onglet Messages)
  if (data) setRelances(relancesOf(data));
  return data ?? null;
}

// Le worker s'authentifie avec la clé affichée sur la page LinkedIn du CRM
export async function checkExtKey(request: NextRequest): Promise<LinkedinSettings | null> {
  const key = request.headers.get('x-ext-key');
  if (!key) return null;
  const s = await getLinkedinSettings();
  return s && s.ext_key === key ? s : null;
}

// « https://fr.linkedin.com/in/Jean-Dupont-123/?trk=x » → « jean-dupont-123 »
export function linkedinSlug(url: string | null | undefined): string | null {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/in\/([^/?#\s]+)/i);
  if (!m) return null;
  try { return decodeURIComponent(m[1]).toLowerCase(); } catch { return m[1].toLowerCase(); }
}

export function linkedinProfileUrl(url: string | null | undefined): string | null {
  const slug = linkedinSlug(url);
  return slug ? `https://www.linkedin.com/in/${encodeURIComponent(slug)}/` : null;
}

export function linkedinActivityUrl(url: string | null | undefined): string | null {
  const p = linkedinProfileUrl(url);
  return p ? `${p}recent-activity/all/` : null;
}

// Prénom avec majuscule initiale (« jean-marc » → « Jean-Marc »)
export function capitalizeName(s: string | null | undefined): string {
  return (s ?? '').trim().toLowerCase().replace(new RegExp("(^|[\\s'-])(\\p{L})", 'gu'), (_, a, b) => a + b.toUpperCase());
}

// ── Heure de Paris, fenêtre d'envoi, jours ouvrés ──

export function parisParts(d = new Date()): { hour: number; weekday: number } {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', hour: '2-digit', weekday: 'short' })
      .formatToParts(d).map((x) => [x.type, x.value]),
  );
  return { hour: Number(p.hour), weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) };
}

// Fenêtre d'activité (sprint46) : jours ouvrés, 9 h – 18 h 30, hors pause déjeuner
export function inWorkingHours(s: LinkedinSettings, now = new Date()): boolean {
  return inActivityWindow(s, now);
}

// J + n jours ouvrés (samedi et dimanche sautés), même heure
export function addBusinessDays(from: Date, n: number): Date {
  const d = new Date(from);
  let left = n;
  while (left > 0) {
    d.setTime(d.getTime() + 86_400_000);
    const { weekday } = parisParts(d);
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return d;
}

// Échéance du premier message : le délai réglé après l'acceptation, à toute heure (les messages
// ne dépendent pas de la fenêtre d'activité, réservée aux invitations)
export function firstMessageDue(s: LinkedinSettings, acceptedAt = new Date()): Date {
  const h = s.first_msg_min_hours + Math.random() * Math.max(0, s.first_msg_max_hours - s.first_msg_min_hours);
  return new Date(acceptedAt.getTime() + h * 3600_000);
}

// ── Plafonds ──

// Actions réussies depuis une date (journal), par type
export async function countOk(actions: string[], since: Date): Promise<number> {
  const { count } = await (supabase as any).from('linkedin_log')
    .select('id', { count: 'exact', head: true })
    .in('action', actions).eq('result', 'ok').gte('created_at', since.toISOString());
  return count ?? 0;
}
export const countToday = (kind: 'invite' | 'message') =>
  countOk(kind === 'invite' ? ['invite'] : ['dm', 'followup'], startOfTodayParis());
export const countInvitesWeek = () => countOk(['invite'], new Date(Date.now() - 7 * 86_400_000));

// Cible du jour : celle du plan du jour s'il existe, sinon le milieu du palier actuel
export function invitesPerDay(s: LinkedinSettings, now = new Date()): number {
  if (s.day_plan && s.day_plan.date === parisClock(now).date) return s.day_plan.target;
  const t = tierOf(s);
  return Math.round((t.min + t.max) / 2);
}
export { weeklyCap };

// ── Historique de la fiche et notifications ──

export async function liEvent(leadId: string, from: string | null, to: string | null, note: string) {
  await (supabase as any).from('lead_history').insert({
    lead_id: leadId, field_changed: 'li_status',
    old_value: from ? (LI_STATUS_LABELS[from] ?? from) : null,
    new_value: to ? (LI_STATUS_LABELS[to] ?? to) : null,
    action_note: `LinkedIn : ${note}`.slice(0, 1000),
  });
}

const APP_URL = process.env.APP_URL || 'https://payment-flow-crm-delta.vercel.app';
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// E-mail à Lomig (son adresse d'expéditeur, ou LINKEDIN_NOTIFY_EMAIL). Ne bloque jamais la séquence.
export async function notifyLomig(subject: string, lines: string[], link?: { label: string; url: string }) {
  const to = process.env.LINKEDIN_NOTIFY_EMAIL || (process.env.SMTP_FROM ?? '').match(/<(.+)>/)?.[1] || process.env.SMTP_FROM;
  if (!to) return;
  const all = [...lines, `Page LinkedIn du CRM : ${APP_URL}/linkedin`];
  try {
    await sendLeadEmail({
      to, subject: `LinkedIn · ${subject}`,
      text: [...all, ...(link ? [`${link.label} : ${link.url}`] : [])].join('\n\n'),
      html: `<div style="font-family:Arial,sans-serif;max-width:600px">${all.map((l) => `<p>${esc(l).replace(/\n/g, '<br>')}</p>`).join('')}`
        + (link ? `<p><a href="${esc(link.url)}">${esc(link.label)}</a></p>` : '') + '</div>',
    });
  } catch (e) {
    console.error('Notification LinkedIn non envoyée', e);
  }
}

// Événement du compte (palier, cooldown, blocage, reprise) : historique sur /linkedin + e-mail
export async function accountEvent(type: string, detail: string, notify?: { subject: string; lines: string[] }) {
  await (supabase as any).from('linkedin_events').insert({ type, detail: detail.slice(0, 1000) });
  if (notify) await notifyLomig(notify.subject, notify.lines);
}

// Blocage (captcha, vérification d'identité, déconnexion) : arrêt total, déblocage manuel sur /linkedin
export async function blockAccount(reason: string) {
  const now = new Date().toISOString();
  await (supabase as any).from('linkedin_settings')
    .update({ account_state: 'blocked', stop_reason: reason, stopped_at: now, alert: reason, alert_at: now }).eq('id', 1);
  await accountEvent('blocked', reason, { subject: 'compte BLOQUÉ', lines: [
    `Toutes les actions LinkedIn sont arrêtées : ${reason}.`,
    'Rien ne repartira seul. Réglez le problème sur l\'écran du VPS (captcha, vérification, connexion), puis cliquez sur « Débloquer » dans /linkedin.',
  ] });
}
// Rétrocompatibilité : ancien nom
export const stopSequence = blockAccount;

// Cooldown (limite hebdomadaire, restriction, erreurs répétées) : 7 jours sans aucune action,
// puis reprise automatique deux paliers plus bas
export async function cooldownAccount(s: LinkedinSettings, reason: string) {
  const { tier, until } = cooldownOutcome(s);
  const now = new Date().toISOString();
  await (supabase as any).from('linkedin_settings').update({
    account_state: 'cooldown', cooldown_until: until.toISOString(), tier, tier_since: until.toISOString(),
    day_plan: null, error_streak: 0, alert: `Cooldown : ${reason}`, alert_at: now,
  }).eq('id', 1);
  const until_fr = until.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'full', timeStyle: 'short' });
  await accountEvent('cooldown', `${reason} — reprise le ${until_fr} au palier ${tier}`, { subject: 'invitations en pause 7 jours', lines: [
    `LinkedIn a signalé : ${reason}. Les invitations sont suspendues ; acceptations, messages, relances et réponses continuent.`,
    `Reprise automatique le ${until_fr}, au palier ${tier} (deux paliers plus bas).`,
  ] });
}

// Q1 / Q2 en alternance, quelle que soit la variante
export async function nextQuestion(s: LinkedinSettings): Promise<Question> {
  const q: Question = s.last_question === 'cout_client' ? 'regularite' : 'cout_client';
  await (supabase as any).from('linkedin_settings').update({ last_question: q }).eq('id', 1);
  s.last_question = q;
  return q;
}

// Prévision des invitations : jour où chaque lead de la file sera invité, à la cadence de la
// montée en charge (jours ouvrés, plafond du jour, plafond sur 7 jours glissants). Indicatif :
// une erreur, une pause ou un arrêt décale tout.
export function forecastInvites(s: LinkedinSettings, queued: string[], invitedToday: number, invitesLast7: number[], now = new Date()): Map<string, Date> {
  const out = new Map<string, Date>();
  if (!s.enabled || s.stop_reason || s.account_state !== 'active') return out;
  // invitesLast7 : invitations des 6 jours précédents (du plus ancien au plus récent)
  const window = [...invitesLast7.slice(-6), invitedToday];
  let day = new Date(now);
  let usedToday = invitedToday;
  let i = 0;
  for (let guard = 0; i < queued.length && guard < 400; guard++) {
    const { hour, weekday } = parisParts(day);
    const open = !(s.weekdays_only && (weekday === 0 || weekday === 6)) && hour < s.work_end_hour;
    if (open) {
      const weekUsed = window.reduce((a, b) => a + b, 0);
      let room = Math.min(invitesPerDay(s, day) - usedToday, weeklyCap(s) - weekUsed);
      while (room > 0 && i < queued.length) {
        out.set(queued[i++], new Date(day));
        room--; usedToday++; window[window.length - 1]++;
      }
    }
    // Jour suivant, à l'ouverture de la fenêtre
    const next = new Date(day.getTime() + 86_400_000);
    const h = parisParts(next).hour;
    day = new Date(next.getTime() - (h - s.work_start_hour) * 3600_000 - next.getMinutes() * 60_000);
    window.shift(); window.push(0);
    usedToday = 0;
  }
  return out;
}
