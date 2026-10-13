// Tests de la montée en charge LinkedIn (sprint46) : paliers, taux d'acceptation sur fenêtre
// glissante, plafond 7 jours, cooldown, plan du jour, fenêtre horaire.
// Lancer : npx tsx scripts/tests/linkedin-ramp.test.ts
import assert from 'node:assert/strict';
import {
  acceptanceRate, evaluateTier, weeklyCap, dailyTarget, inviteRoom, planDay, classifyIncident, cooldownOutcome,
  inviteDelayMs, inActivityWindow, type RampSettings, type Invite,
} from '../../src/lib/linkedinRamp';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name); };
const DAY = 86_400_000;
const now = new Date('2026-10-20T10:00:00+02:00');   // mardi
const ago = (d: number) => new Date(now.getTime() - d * DAY).toISOString();
// n invitations envoyées il y a `d` jours, dont `acc` acceptées
const batch = (n: number, acc: number, d: number): Invite[] =>
  Array.from({ length: n }, (_, i) => ({ invited_at: ago(d), connected_at: i < acc ? ago(d - 1) : null }));
const seq = (seed: number) => () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };

const base: RampSettings = {
  tiers: [{ min: 10, max: 12 }, { min: 15, max: 15 }, { min: 20, max: 20 }, { min: 25, max: 25 }],
  tier: 1, tier_since: ago(8), promote_min_days: 7, promote_rate: 30, promote_rate_last: 35, demote_rate: 25,
  rate_min_sample: 15, weekly_invite_cap: 100, last_tier_bonus_pct: 25, volume_jitter_pct: 20,
  day_start_min: 540, day_end_min: 1110, lunch_start_min: 750, lunch_end_min: 825,
  invite_gap_min: 3, invite_gap_max: 12, sessions_min: 2, sessions_max: 3, weekdays_only: true,
  cooldown_days: 7, cooldown_tier_drop: 2,
};

test('taux d\'acceptation : seules les invitations de la fenêtre comptent', () => {
  const inv = [...batch(10, 5, 3), ...batch(20, 8, 10), ...batch(10, 10, 30)];
  const r = acceptanceRate(inv, now, 7, 21);
  assert.equal(r.sent, 20); assert.equal(r.accepted, 8); assert.equal(r.rate, 0.4);
  assert.equal(acceptanceRate([], now, 7, 14).rate, null);
});
test('palier : monte après 7 jours sans incident et ≥ 30 %', () => {
  assert.equal(evaluateTier(base, batch(20, 7, 9), false, now).action, 'up');   // 35 %
});
test('palier : reste si moins de 7 jours au palier', () => {
  assert.equal(evaluateTier({ ...base, tier_since: ago(5) }, batch(20, 10, 9), false, now).action, 'stay');
});
test('palier : reste après un incident pendant le palier', () => {
  assert.equal(evaluateTier(base, batch(20, 10, 9), true, now).action, 'stay');
});
test('palier : reste sous 30 % ou avec trop peu d\'invitations mûres', () => {
  assert.equal(evaluateTier(base, batch(20, 5, 9), false, now).action, 'stay');   // 25 %
  assert.equal(evaluateTier(base, batch(10, 9, 9), false, now).action, 'stay');   // 10 < 15
});
test('palier : 35 % exigés pour passer au dernier palier', () => {
  const t3 = { ...base, tier: 3 };
  assert.equal(evaluateTier(t3, batch(20, 6, 9), false, now).action, 'stay');     // 30 %
  assert.equal(evaluateTier(t3, batch(20, 7, 9), false, now).action, 'up');       // 35 %
  assert.equal(evaluateTier({ ...base, tier: 4 }, batch(20, 15, 9), false, now).action, 'stay');
});
test('palier : redescend sous 25 % sur 7 j glissants (invitations de 7 à 14 j)', () => {
  const t2 = { ...base, tier: 2, tier_since: ago(2) };
  assert.equal(evaluateTier(t2, batch(20, 4, 10), false, now).action, 'down');     // 20 %
  assert.equal(evaluateTier(t2, batch(20, 4, 3), false, now).action, 'stay');      // trop récentes
  assert.equal(evaluateTier({ ...t2, tier: 1 }, batch(20, 0, 10), false, now).action, 'stay');   // déjà au palier 1
});
test('plafond 7 jours : 100, 125 au dernier palier, bloque à la limite', () => {
  assert.equal(weeklyCap(base), 100); assert.equal(weeklyCap({ ...base, tier: 4 }), 125);
  const plan = { date: '2026-10-20', target: 12, sessions: [{ start: 540, end: 700, count: 12 }] };
  assert.equal(inviteRoom(base, plan, 0, 100, 600).room, 0);
  assert.match(inviteRoom(base, plan, 0, 100, 600).reason!, /7 jours/);
  assert.equal(inviteRoom(base, plan, 0, 95, 600).room, 5);
  assert.equal(inviteRoom({ ...base, tier: 4 }, plan, 0, 110, 600).room, 12);
});
test('sessions : pas d\'invitation hors session, rattrapage d\'une session manquée', () => {
  const plan = { date: '2026-10-20', target: 10, sessions: [{ start: 560, end: 640, count: 4 }, { start: 860, end: 950, count: 6 }] };
  assert.equal(inviteRoom(base, plan, 0, 0, 700).room, 0);       // entre deux sessions
  assert.equal(inviteRoom(base, plan, 4, 0, 880).room, 6);
  assert.equal(inviteRoom(base, plan, 1, 0, 880).room, 9);       // 3 manquées le matin, rattrapées
  assert.equal(inviteRoom(base, plan, 10, 0, 900).room, 0);
});
test('cible du jour : dans le palier ±20 %', () => {
  const rng = seq(7);
  for (let i = 0; i < 200; i++) {
    const t = dailyTarget(base, rng); assert.ok(t >= 8 && t <= 15, `palier 1 : ${t}`);
    const t3 = dailyTarget({ ...base, tier: 3 }, rng); assert.ok(t3 >= 16 && t3 <= 24, `palier 3 : ${t3}`);
  }
});
test('plan du jour : 2 ou 3 sessions, hors déjeuner, total = cible', () => {
  const rng = seq(42);
  for (let i = 0; i < 200; i++) {
    const p = planDay(base, '2026-10-20', rng);
    assert.ok(p.sessions.length >= 2 && p.sessions.length <= 3);
    assert.equal(p.sessions.reduce((a, x) => a + x.count, 0), p.target);
    for (const x of p.sessions) {
      assert.ok(x.start >= 540 && x.end <= 1110);
      assert.ok(x.end <= 750 || x.start >= 825, `session ${x.start}-${x.end} empiète sur le déjeuner`);
    }
  }
});
test('délai entre invitations : 3 à 12 min, pas constant', () => {
  const rng = seq(3);
  const d = Array.from({ length: 500 }, () => inviteDelayMs(base, rng) / 60_000);
  assert.ok(d.every((x) => x >= 3 && x <= 12));
  assert.ok(new Set(d.map((x) => Math.round(x))).size >= 8);
  assert.ok(d.reduce((a, b) => a + b, 0) / d.length < 7.5);   // plutôt court en moyenne
});
test('fenêtre : 9 h – 18 h 30, pause 12 h 30 – 13 h 45, pas le week-end', () => {
  const at = (iso: string) => inActivityWindow(base, new Date(iso));
  assert.equal(at('2026-10-20T08:59:00+02:00'), false); assert.equal(at('2026-10-20T09:00:00+02:00'), true);
  assert.equal(at('2026-10-20T12:45:00+02:00'), false); assert.equal(at('2026-10-20T13:45:00+02:00'), true);
  assert.equal(at('2026-10-20T18:29:00+02:00'), true);  assert.equal(at('2026-10-20T18:30:00+02:00'), false);
  assert.equal(at('2026-10-24T10:00:00+02:00'), false);
});
test('incidents : captcha / identité / déconnexion = blocage ; limite / restriction = cooldown', () => {
  assert.equal(classifyIncident('auth'), 'blocked');
  assert.equal(classifyIncident('verify'), 'blocked');
  assert.equal(classifyIncident('warning', 'captcha'), 'blocked');
  assert.equal(classifyIncident('limit'), 'cooldown');
  assert.equal(classifyIncident('warning', 'activité inhabituelle'), 'cooldown');
  assert.equal(classifyIncident('error_streak'), 'cooldown');
  assert.equal(classifyIncident('ok'), null);
});
test('cooldown : 7 jours, −2 paliers, jamais sous le palier 1', () => {
  const c = cooldownOutcome({ ...base, tier: 4 }, now);
  assert.equal(c.tier, 2); assert.equal(c.until.getTime() - now.getTime(), 7 * DAY);
  assert.equal(cooldownOutcome({ ...base, tier: 2 }, now).tier, 1);
  assert.equal(cooldownOutcome({ ...base, tier: 1 }, now).tier, 1);
});

console.log(`\n${passed} tests réussis`);
