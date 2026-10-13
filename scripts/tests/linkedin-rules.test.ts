// Tests de la séquence LinkedIn v2 : jours ouvrés, prévision des invitations, gabarits et règles de
// rédaction (paliers, fenêtre et plafonds : voir linkedin-ramp.test.ts). Lancer : npx tsx --env-file=.env.local scripts/tests/linkedin-rules.test.ts
import assert from 'node:assert/strict';
import { addBusinessDays, parisParts, forecastInvites, type LinkedinSettings } from '@/lib/linkedin';
import { checkMessage, messageA, messageB, messageC, messagePost, relanceMessage, ageToDays, usablePosts } from '@/lib/linkedinAgent';

let passed = 0;
const test = (name: string, fn: () => void) => { fn(); passed++; console.log('✓', name); };
const paris = (iso: string) => new Date(iso);   // dates écrites en heure de Paris (UTC+2 en octobre)

const s = {
  weekdays_only: true, work_start_hour: 9, work_end_hour: 19, weekly_invite_cap: 100, last_tier_bonus_pct: 25,
  tiers: [{ min: 10, max: 12 }, { min: 15, max: 15 }, { min: 20, max: 20 }, { min: 25, max: 25 }], tier: 1,
  day_plan: null, account_state: 'active',
} as unknown as LinkedinSettings;

test('jours ouvrés : jeudi + 3 = mardi, vendredi + 7 = mardi + 1 sem.', () => {
  assert.equal(parisParts(addBusinessDays(paris('2026-10-15T10:00:00+02:00'), 3)).weekday, 2);
  assert.equal(addBusinessDays(paris('2026-10-16T10:00:00+02:00'), 7).toISOString().slice(0, 10), '2026-10-27');
  assert.equal(addBusinessDays(paris('2026-10-12T10:00:00+02:00'), 14).toISOString().slice(0, 10), '2026-10-30');
});

const lead = { first_name: 'marc', company: 'Atelier Martin' };
test('variante C : gabarit exact, prénom capitalisé, conforme', () => {
  const m = messageC(lead, 'cout_client');
  assert.equal(m, "Bonjour Marc, merci d'avoir accepté. J'ai pris le temps de regarder ce que vous faites chez Atelier Martin, c'est un beau projet. Je suis curieux : aujourd'hui, vous savez combien vous coûte un nouveau client ?");
  assert.deepEqual(checkMessage(m, { first: true }), []);
});
test('variante C sans entreprise', () => {
  assert.match(messageC({ first_name: 'Marc', company: '' }, 'regularite'), /ce que vous faites, c'est un beau projet\. Je suis curieux : vos nouveaux clients/);
});
test('variantes A et B : exemples du cahier des charges', () => {
  assert.equal(messageA({ first_name: 'Julien' }, 'cout_client', 'le recrutement de poseurs qualifiés', 'la formation en interne'),
    "Bonjour Julien, merci d'avoir accepté. J'ai lu votre post sur le recrutement de poseurs qualifiés, votre point sur la formation en interne est très juste. Je suis curieux : aujourd'hui, vous savez combien vous coûte un nouveau client ?");
  const b = messageB({ first_name: 'Sarah' }, 'regularite', 'Passer de salariée en agence à fondatrice de votre propre cabinet en deux ans');
  assert.equal(b, "Bonjour Sarah, merci d'avoir accepté. Passer de salariée en agence à fondatrice de votre propre cabinet en deux ans, ce n'est pas rien. Je suis curieux : vos nouveaux clients arrivent plutôt régulièrement, ou ça dépend beaucoup des périodes ?");
  assert.deepEqual(checkMessage(b, { first: true }), []);
});
test('règles : le mauvais exemple est refusé', () => {
  const bad = 'Bonjour Marc ! Super post, très inspirant 🔥 Vous cherchez sûrement à avoir plus de clients ? Chez Payment Flow on peut vous aider.';
  const issues = checkMessage(bad, { first: true }).join(' | ');
  for (const w of ['exclamation', 'emoji', 'inspirant', 'payment']) assert.match(issues, new RegExp(w, 'i'));
});
test('règles : plus de 300 caractères, lien, Google, site', () => {
  assert.match(checkMessage('x'.repeat(301), { first: true }).join(), /301/);
  assert.ok(checkMessage('Voir https://exemple.fr', { first: false }).length);
  assert.ok(checkMessage('Vous êtes bien noté sur Google', { first: false }).length);
  assert.ok(checkMessage('Votre site est clair', { first: false }).length);
});
test('relances R1 / R2 / R3 et relance post : conformes, même question', () => {
  for (const q of ['cout_client', 'regularite'] as const) {
    for (const st of ['r1', 'r2', 'r3'] as const) {
      const m = relanceMessage(st, lead, q);
      assert.deepEqual(checkMessage(m, { first: false }), [], `${st} ${q} : ${m}`);
      assert.doesNotMatch(m, /je me permets|avez-vous vu/i);
    }
  }
  assert.match(relanceMessage('r1', lead, 'cout_client'), /^Marc, je remonte mon message/);
  assert.match(relanceMessage('r2', { first_name: 'Marc', company: '' }, 'cout_client'), /pour votre activité \?$/);
  assert.match(relanceMessage('r2', { first_name: 'Marc', company: '' }, 'regularite'), /Chez vous, c'est plutôt prévisible \?$/);
  const post = messagePost(lead, 'regularite', 'votre nouveau showroom', 'la photo de l\'équipe au complet');
  assert.equal(post, "Marc, je viens de voir votre post sur votre nouveau showroom, la photo de l'équipe au complet m'a fait sourire. Du coup, je repose ma question : vos nouveaux clients, c'est plutôt régulier ou en dents de scie ?");
});
test('âge des posts et filtre (< 60 j, pas de simple partage)', () => {
  assert.equal(ageToDays('3 j'), 3); assert.equal(ageToDays('2 sem.'), 14); assert.equal(ageToDays('5 mois'), 150);
  assert.equal(ageToDays('4 h'), 0); assert.equal(ageToDays('1 an'), 365);
  const posts = usablePosts({ posts: [
    { text: 'Chantier terminé', age: '2 sem.', age_days: null, repost: false, url: null },
    { text: 'Partage', age: '3 j', age_days: null, repost: true, url: null },
    { text: 'Ancien', age: '3 mois', age_days: null, repost: false, url: null },
  ] });
  assert.deepEqual(posts.map((p) => p.text), ['Chantier terminé']);
});

test('prévision : cible du palier par jour ouvré, week-end sauté, plafond 7 jours', () => {
  const live = { ...s, enabled: true, stop_reason: null } as LinkedinSettings;
  const ids = Array.from({ length: 40 }, (_, i) => `l${i}`);
  // Jeudi 15/10 à 12 h, palier 1 (11 / jour), 2 invitations déjà faites aujourd'hui
  const f = forecastInvites(live, ids, 2, [0, 0, 0, 0, 0, 0], paris('2026-10-15T12:00:00+02:00'));
  const day = (id: string) => f.get(id)!.toISOString().slice(0, 10);
  assert.equal(day('l0'), '2026-10-15'); assert.equal(day('l8'), '2026-10-15');    // 9 restantes jeudi
  assert.equal(day('l9'), '2026-10-16'); assert.equal(day('l19'), '2026-10-16');   // 11 vendredi
  assert.equal(day('l20'), '2026-10-19');                                         // lundi
  // Plafond 7 jours : 95 déjà envoyées → 5 seulement aujourd'hui
  const g = forecastInvites(live, ids, 0, [20, 20, 20, 20, 15, 0], paris('2026-10-15T12:00:00+02:00'));
  assert.equal(Array.from(g.values()).filter((d) => d.toISOString().startsWith('2026-10-15')).length, 5);
  assert.equal(forecastInvites({ ...live, account_state: 'cooldown' } as LinkedinSettings, ids, 0, [], new Date()).size, 0);
});

console.log(`\n${passed} tests réussis`);
