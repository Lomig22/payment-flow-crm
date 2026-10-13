// Connexion LinkedIn, à lancer SUR TON MAC : ouvre Chromium, tu te connectes normalement
// (mot de passe, code 2FA…), et la session est enregistrée dans state.json, à copier ensuite
// sur le VPS (voir README). À relancer si le CRM affiche « Session LinkedIn déconnectée ».
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(DIR, 'state.json');

const browser = await chromium.launch({ headless: false });
const context = await browser.newContext({ locale: 'fr-FR', timezoneId: 'Europe/Paris', viewport: { width: 1366, height: 820 } });
const page = await context.newPage();
await page.goto('https://www.linkedin.com/login');
console.log('Connecte-toi à LinkedIn dans la fenêtre ouverte (15 min max)…');

// Connecté = cookie de session « li_at » présent, quelle que soit la page d'arrivée
const deadline = Date.now() + 15 * 60_000;
while (!(await context.cookies('https://www.linkedin.com')).some((c) => c.name === 'li_at')) {
  if (Date.now() > deadline) { console.error('Pas de connexion au bout de 15 min'); await browser.close(); process.exit(1); }
  await page.waitForTimeout(2000);
}
await page.waitForTimeout(5000);   // laisse LinkedIn poser ses autres cookies
await context.storageState({ path: STATE_FILE });
console.log(`Session enregistrée : ${STATE_FILE}`);
await browser.close();
