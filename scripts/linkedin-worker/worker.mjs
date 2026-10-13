// Worker LinkedIn (VPS) : même rôle que l'extension Chrome, mais sur un serveur, pour que la
// séquence tourne même ordinateur éteint.
// Toutes les 2 min : demande au CRM la prochaine action (/api/linkedin/ext/queue), l'exécute
// dans Chromium, puis rend compte (/api/linkedin/ext/report). Plafonds, horaires et délais sont
// gérés par le CRM.
// Depuis le 11/10/2026 : un seul Chromium permanent, avec un profil conservé sur le disque
// (PROFILE_DIR), affiché sur l'écran virtuel :42 que Lomig voit à distance (noVNC via tunnel SSH).
// Lomig se connecte à LinkedIn DANS ce navigateur : la session est créée et utilisée sur la même
// machine. (Une session créée sur le Mac puis copiée sur le VPS avait été invalidée.) Si LinkedIn
// redemande une connexion, le worker laisse la page ouverte, attend, puis reprend seul.
import { chromium } from 'playwright';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
// Le CRM fixe l'heure de la prochaine action (délais de 3 à 12 min) : on l'interroge chaque minute
const TICK_MS = 60_000;

async function loadEnv() {
  const env = {};
  try {
    for (const line of (await fs.readFile(path.join(DIR, '.env'), 'utf8')).split('\n')) {
      const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch { /* pas de .env : variables d'environnement seules */ }
  return { ...env, ...process.env };
}

const env = await loadEnv();
const CRM_URL    = (env.CRM_URL || '').replace(/\/$/, '');
const EXT_KEY    = env.EXT_KEY || '';
const WORKER_ID  = env.WORKER_ID || `vps-${os.hostname()}`;
const PROFILE_DIR = env.PROFILE_DIR || path.join(DIR, 'profile');
if (!CRM_URL || !EXT_KEY) { console.error('CRM_URL et EXT_KEY sont requis (.env)'); process.exit(1); }

// pageAction() : le code exécuté dans la page, partagé avec l'extension
const PAGE_ACTION_SRC = await fs.readFile(path.join(DIR, 'pageAction.js'), 'utf8');

const log = (...a) => console.log(new Date().toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function crm(p, init = {}) {
  const res = await fetch(CRM_URL + p, {
    ...init,
    // Identité du robot (une seule session LinkedIn à la fois) et présence d'un proxy
    headers: { 'Content-Type': 'application/json', 'x-ext-key': EXT_KEY, 'x-worker-id': WORKER_ID, 'x-worker-proxy': env.PROXY_URL ? '1' : '0' },
  });
  if (!res.ok) throw new Error(`CRM ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return res.json();
}

function proxyOption() {
  if (!env.PROXY_URL) return undefined;
  const u = new URL(env.PROXY_URL);
  return {
    server: `${u.protocol}//${u.host}`,
    username: decodeURIComponent(u.username) || undefined,
    password: decodeURIComponent(u.password) || undefined,
  };
}

let context = null;
let loginPage = null;   // page de connexion laissée ouverte tant que Lomig ne s'est pas connecté

async function getContext() {
  if (context) return context;
  context = await chromium.launchPersistentContext(PROFILE_DIR, {
    headless: false, proxy: proxyOption(),
    locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1366, height: 820 },
  });
  context.on('close', () => { context = null; loginPage = null; });
  return context;
}

const loggedIn = async (ctx) => (await ctx.cookies('https://www.linkedin.com')).some((c) => c.name === 'li_at' && (c.expires === -1 || c.expires * 1000 > Date.now()));

// Pas de session : le CRM arrête la séquence et prévient Lomig (une fois), une page de connexion
// reste ouverte à l'écran et le worker attend
async function waitForLogin(ctx) {
  if (!loginPage || loginPage.isClosed()) {
    loginPage = await ctx.newPage();
    await loginPage.goto('https://www.linkedin.com/login', { waitUntil: 'domcontentloaded', timeout: 45_000 }).catch(() => {});
    log('Session LinkedIn absente : connexion à faire sur l\'écran à distance');
    await crm('/api/linkedin/ext/report', { method: 'POST', body: JSON.stringify({ type: 'session', result: 'auth', detail: 'Session absente sur le VPS' }) }).catch(() => {});
  }
}

// Une page : chargement, puis pageAction (partagé avec l'extension) dans la page
async function onPage(url, type, message) {
  const ctx = await getContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45_000 });
    await sleep(3000 + Math.random() * 3000);   // laisse LinkedIn finir de charger (contenu dynamique)
    return await page.evaluate(
      `(async () => {\n${PAGE_ACTION_SRC}\nreturn pageAction(${JSON.stringify(type)}, ${JSON.stringify(message || '')});\n})()`,
    );
  } finally {
    await sleep(1500);
    await page.close().catch(() => {});
  }
}

async function run(next) {
  // Messagerie : la liste des leads à surveiller passe par le paramètre « message »
  const message = next.message ?? (next.names ? JSON.stringify(next.names) : '');
  if (next.type !== 'profile') return onPage(next.url, next.type, message);
  // Profil : la fiche, puis ses publications (une seule visite par lead)
  const prof = await onPage(next.url, 'profile', '');
  if (prof?.result !== 'ok' || !next.activity_url) return prof;
  await sleep(4000 + Math.random() * 6000);
  const act = await onPage(next.activity_url, 'posts', '');
  if (act?.result !== 'ok') return ['auth', 'limit', 'warning'].includes(act?.result) ? act : { ...prof, profile: { ...prof.profile, posts: [] } };
  return { ...prof, profile: { ...prof.profile, posts: act.posts } };
}

async function tick() {
  const ctx = await getContext();
  if (!(await loggedIn(ctx))) return waitForLogin(ctx);
  if (loginPage) {
    // Lomig vient de se reconnecter : noté dans le journal (la séquence ne repart que s'il la réactive)
    await loginPage.close().catch(() => {});
    loginPage = null;
    await crm('/api/linkedin/ext/report', { method: 'POST', body: JSON.stringify({ type: 'session', result: 'ok' }) }).catch(() => {});
    log('Session LinkedIn rétablie');
  }
  const { next, reason } = await crm('/api/linkedin/ext/queue');
  if (!next) { log('·', reason || 'Rien à faire'); return; }

  log('→', next.type, next.url);
  let out;
  try {
    out = await run(next);
  } catch (e) {
    out = { result: 'error', detail: String(e?.message || e).slice(0, 300) };
    // Navigateur dans un état douteux : on repart d'un navigateur neuf au prochain passage
    await context?.close().catch(() => {});
    context = null;
  }
  if (!out || !out.result) out = { result: 'error', detail: 'Pas de réponse de la page' };
  await crm('/api/linkedin/ext/report', {
    method: 'POST',
    body: JSON.stringify({ type: next.type, lead_id: next.lead_id, ...(next.type === 'invite' ? { inv_variant: next.inv_variant, note: next.message || null } : {}), ...out }),
  });
  log('←', next.type, out.result, out.detail
    || (out.slugs ? `${out.slugs.length} relations` : out.replies ? `${out.replies.length} réponse(s)` : out.posts ? `${out.posts.length} publication(s)` : out.profile ? `profil lu, ${(out.profile.posts || []).length} publication(s)` : ''));
}

process.on('SIGTERM', async () => { await context?.close().catch(() => {}); process.exit(0); });

log(`Worker LinkedIn démarré (CRM : ${CRM_URL})`);
for (;;) {
  try { await tick(); } catch (e) { log('Erreur :', e?.message || e); }
  await sleep(TICK_MS);
}
