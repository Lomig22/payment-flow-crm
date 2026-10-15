// Montée en charge intelligente LinkedIn (sprint46, cahier des charges du 13/10/2026).
// Logique pure (aucun accès base ni LinkedIn), testée par scripts/tests/linkedin-ramp.test.ts :
// paliers, taux d'acceptation sur fenêtre glissante, plafond 7 jours, cooldown, plan du jour.

export interface Tier { min: number; max: number }
export type AccountState = 'active' | 'cooldown' | 'blocked';

export interface RampSettings {
  tiers: Tier[];
  tier: number;                    // 1-based
  tier_since: string | null;
  promote_min_days: number;
  promote_rate: number;            // %
  promote_rate_last: number;       // % pour monter au dernier palier
  demote_rate: number;             // %
  rate_min_sample: number;
  weekly_invite_cap: number;
  last_tier_bonus_pct: number;
  volume_jitter_pct: number;
  day_start_min: number; day_end_min: number; lunch_start_min: number; lunch_end_min: number;
  invite_gap_min: number; invite_gap_max: number;
  sessions_min: number; sessions_max: number;
  weekdays_only: boolean;
  cooldown_days: number; cooldown_tier_drop: number;
}

export interface Invite { invited_at: string; connected_at: string | null }
export interface Session { start: number; end: number; count: number }   // minutes depuis minuit (Paris)
export interface DayPlan { date: string; target: number; sessions: Session[] }

const DAY = 86_400_000;
type Rng = () => number;

// ── Heure de Paris ──
export function parisClock(d = new Date()): { date: string; minutes: number; weekday: number } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(d).map((x) => [x.type, x.value]));
  return {
    date: `${p.year}-${p.month}-${p.day}`,
    minutes: Number(p.hour) * 60 + Number(p.minute),
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday),
  };
}

// Fenêtre d'activité : jours ouvrés, 9 h – 18 h 30, hors pause déjeuner
export function inActivityWindow(s: Pick<RampSettings, 'weekdays_only' | 'day_start_min' | 'day_end_min' | 'lunch_start_min' | 'lunch_end_min'>, now = new Date()): boolean {
  const { minutes, weekday } = parisClock(now);
  if (s.weekdays_only && (weekday === 0 || weekday === 6)) return false;
  if (minutes < s.day_start_min || minutes >= s.day_end_min) return false;
  return !(minutes >= s.lunch_start_min && minutes < s.lunch_end_min);
}

// ── Paliers et plafonds ──
export const tierOf = (s: Pick<RampSettings, 'tiers' | 'tier'>): Tier => s.tiers[Math.min(Math.max(1, s.tier), s.tiers.length) - 1];
export const isLastTier = (s: Pick<RampSettings, 'tiers' | 'tier'>) => s.tier >= s.tiers.length;

// Plafond sur 7 jours glissants : +25 % au dernier palier
export function weeklyCap(s: Pick<RampSettings, 'tiers' | 'tier' | 'weekly_invite_cap' | 'last_tier_bonus_pct'>): number {
  return isLastTier(s) ? Math.floor(s.weekly_invite_cap * (1 + s.last_tier_bonus_pct / 100)) : s.weekly_invite_cap;
}

// Cible du jour : tirée dans le palier, puis variée de ±volume_jitter_pct
export function dailyTarget(s: Pick<RampSettings, 'tiers' | 'tier' | 'volume_jitter_pct'>, rng: Rng = Math.random): number {
  const t = tierOf(s);
  const base = t.min + rng() * (t.max - t.min);
  const j = s.volume_jitter_pct / 100;
  return Math.max(1, Math.round(base * (1 + (rng() * 2 - 1) * j)));
}

// ── Taux d'acceptation sur fenêtre glissante ──
// Invitations envoyées entre (now − toDays) et (now − fromDays) : fromDays = 7 laisse le temps d'accepter
export function acceptanceRate(invites: Invite[], now: Date, fromDays: number, toDays: number): { rate: number | null; sent: number; accepted: number } {
  const lo = now.getTime() - toDays * DAY, hi = now.getTime() - fromDays * DAY;
  const pool = invites.filter((i) => { const t = new Date(i.invited_at).getTime(); return t > lo && t <= hi; });
  const accepted = pool.filter((i) => i.connected_at).length;
  return { rate: pool.length ? accepted / pool.length : null, sent: pool.length, accepted };
}

// ── Évolution du palier (une fois par jour) ──
// Monter : ≥ promote_min_days au palier sans incident ET taux ≥ 30 % (35 % vers le dernier) sur les
// invitations de 7 à 21 jours. Redescendre : taux < 25 % sur les invitations de 7 à 14 jours.
export function evaluateTier(s: RampSettings, invites: Invite[], incidentSinceTier: boolean, now = new Date())
  : { action: 'up' | 'down' | 'stay'; reason: string } {
  const recent = acceptanceRate(invites, now, 7, 14);
  if (s.tier > 1 && recent.rate != null && recent.sent >= s.rate_min_sample && recent.rate * 100 < s.demote_rate) {
    return { action: 'down', reason: `taux d'acceptation ${Math.round(recent.rate * 100)} % (< ${s.demote_rate} %) sur ${recent.sent} invitations de 7 à 14 jours` };
  }
  if (isLastTier(s)) return { action: 'stay', reason: 'dernier palier' };
  const days = s.tier_since ? (now.getTime() - new Date(s.tier_since).getTime()) / DAY : 0;
  if (days < s.promote_min_days) return { action: 'stay', reason: `${Math.floor(days)} j au palier (${s.promote_min_days} requis)` };
  if (incidentSinceTier) return { action: 'stay', reason: 'avertissement ou blocage depuis le début du palier' };
  const mature = acceptanceRate(invites, now, 7, 21);
  const needed = s.tier + 1 >= s.tiers.length ? s.promote_rate_last : s.promote_rate;
  if (mature.rate == null || mature.sent < s.rate_min_sample) return { action: 'stay', reason: `pas assez d'invitations de plus de 7 jours (${mature.sent}/${s.rate_min_sample})` };
  if (mature.rate * 100 < needed) return { action: 'stay', reason: `taux d'acceptation ${Math.round(mature.rate * 100)} % (${needed} % requis)` };
  return { action: 'up', reason: `${Math.floor(days)} j sans incident, taux d'acceptation ${Math.round(mature.rate * 100)} % sur ${mature.sent} invitations` };
}

// ── Incidents ──
// Captcha, vérification d'identité, déconnexion : blocage, déblocage manuel. Limite hebdomadaire,
// restriction, erreurs inhabituelles répétées : cooldown de 7 jours, −2 paliers, reprise seule.
export type IncidentKind = 'blocked' | 'cooldown';
export function classifyIncident(result: string, detail = ''): IncidentKind | null {
  if (result === 'auth' || result === 'verify' || /captcha|identit|checkpoint/i.test(detail)) return 'blocked';
  if (result === 'limit' || result === 'warning' || result === 'error_streak') return 'cooldown';
  return null;
}
export function cooldownOutcome(s: Pick<RampSettings, 'tier' | 'cooldown_days' | 'cooldown_tier_drop'>, now = new Date()): { tier: number; until: Date } {
  return { tier: Math.max(1, s.tier - s.cooldown_tier_drop), until: new Date(now.getTime() + s.cooldown_days * DAY) };
}

// ── Plafond 7 jours : invitations encore possibles maintenant ──
export function inviteRoom(s: RampSettings, plan: DayPlan | null, sentToday: number, sentLast7: number, nowMin: number): { room: number; reason: string | null } {
  const capLeft = weeklyCap(s) - sentLast7;
  if (capLeft <= 0) return { room: 0, reason: `plafond de ${weeklyCap(s)} invitations sur 7 jours glissants atteint` };
  if (!plan) return { room: 0, reason: 'pas de plan pour aujourd\'hui' };
  if (sentToday >= plan.target) return { room: 0, reason: `cible du jour atteinte (${sentToday}/${plan.target})` };
  // Sessions commencées : leur quota cumulé (une session manquée se rattrape à la suivante)
  const started = plan.sessions.filter((x) => nowMin >= x.start);
  const inSession = plan.sessions.some((x) => nowMin >= x.start && nowMin < x.end);
  if (!inSession) {
    const next = plan.sessions.find((x) => x.start > nowMin);
    return { room: 0, reason: next ? `prochaine session d'invitations à ${fmtMin(next.start)}` : 'sessions du jour terminées' };
  }
  const allowed = started.reduce((a, x) => a + x.count, 0);
  const room = Math.min(allowed - sentToday, capLeft, plan.target - sentToday);
  return room > 0 ? { room, reason: null } : { room: 0, reason: 'quota de la session atteint' };
}

export const fmtMin = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;

// ── Plan du jour : cible répartie en 2 ou 3 sessions, hors pause déjeuner ──
// `fromMin` : minute de la journée où le plan est établi. Un plan fait en cours de journée (palier
// changé, réglages modifiés, VPS redémarré) ne place pas de session dans le passé : sinon toute la
// cible tombait dans des sessions déjà finies et aucune invitation ne partait (15/10/2026).
export function planDay(s: RampSettings, date: string, rng: Rng = Math.random, target = dailyTarget(s, rng), fromMin = 0): DayPlan {
  const k = s.sessions_min + Math.floor(rng() * (s.sessions_max - s.sessions_min + 1));
  // Plages : matin, début d'après-midi, fin d'après-midi (sans pause déjeuner : la journée en deux ou trois)
  const lunch = s.lunch_end_min > s.lunch_start_min;
  const [ls, le] = lunch ? [s.lunch_start_min, s.lunch_end_min] : [Math.floor((s.day_start_min + s.day_end_min) / 2), Math.floor((s.day_start_min + s.day_end_min) / 2)];
  const all: [number, number][] = k <= 2
    ? [[s.day_start_min, ls], [le, s.day_end_min]]
    : [[s.day_start_min, ls], [le, le + Math.floor((s.day_end_min - le) / 2)], [le + Math.floor((s.day_end_min - le) / 2), s.day_end_min]];
  // Rien dans le passé ; s'il ne reste qu'un bout de journée, une seule session jusqu'à la fin
  let ranges = all.map(([a, b]) => [Math.max(a, fromMin), b] as [number, number]).filter(([a, b]) => b - a >= 15);
  if (!ranges.length && s.day_end_min - fromMin >= 15) ranges = [[fromMin, s.day_end_min]];
  if (!ranges.length) return { date, target, sessions: [] };
  // Répartition du volume : chaque session reçoit au moins 1, le reste au hasard
  const counts: number[] = ranges.map(() => (target >= ranges.length ? 1 : 0));
  for (let i = counts.reduce((a, b) => a + b, 0); i < target; i++) counts[Math.floor(rng() * ranges.length)]++;
  const sessions = ranges.map(([a, b], i) => {
    // Durée : de quoi placer les invitations au rythme moyen, plus une marge, sans dépasser la plage
    const need = Math.max(30, Math.ceil(counts[i] * ((s.invite_gap_min + s.invite_gap_max) / 2) * 1.3));
    const len = Math.min(b - a, need);
    // Plage entamée (plan fait en cours de journée) : la session démarre tout de suite
    const start = fromMin > 0 && a === fromMin ? a : a + Math.floor(rng() * Math.max(1, b - a - len));
    return { start, end: start + len, count: counts[i] };
  }).filter((x) => x.count > 0);
  return { date, target, sessions };
}

// ── Délai entre deux invitations : 3 à 12 min, plutôt court, parfois long (pas de rythme régulier) ──
export function inviteDelayMs(s: Pick<RampSettings, 'invite_gap_min' | 'invite_gap_max'>, rng: Rng = Math.random): number {
  const u = Math.pow(rng(), 1.6);   // distribution asymétrique vers les petits délais
  const jitter = (rng() - 0.5) * 0.15;
  const x = Math.min(1, Math.max(0, u + jitter));
  return Math.round((s.invite_gap_min + x * (s.invite_gap_max - s.invite_gap_min)) * 60_000);
}
