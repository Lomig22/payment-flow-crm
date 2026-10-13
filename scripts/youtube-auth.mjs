// Connecte la chaîne YouTube au CRM (une seule fois) : ouvre la page d'autorisation Google,
// récupère le jeton de rafraîchissement et l'écrit dans .env.local (YT_REFRESH_TOKEN).
// Prérequis dans .env.local : YT_CLIENT_ID, YT_CLIENT_SECRET (client OAuth « Application de bureau »).
// Usage : node scripts/youtube-auth.mjs
import fs from 'fs';
import http from 'http';
import { exec } from 'child_process';

const ENV  = '.env.local';
const env  = Object.fromEntries(fs.readFileSync(ENV, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
if (!env.YT_CLIENT_ID || !env.YT_CLIENT_SECRET) { console.error(`Manque YT_CLIENT_ID / YT_CLIENT_SECRET dans ${ENV}`); process.exit(1); }

const PORT     = 53682;
const REDIRECT = `http://127.0.0.1:${PORT}`;
const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
  client_id: env.YT_CLIENT_ID, redirect_uri: REDIRECT, response_type: 'code',
  scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly',
  access_type: 'offline', prompt: 'consent',
});

const server = http.createServer(async (req, res) => {
  const code = new URL(req.url, REDIRECT).searchParams.get('code');
  if (!code) { res.end('Autorisation refusée ou absente.'); return; }
  try {
    const tok = await (await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      body: new URLSearchParams({ code, client_id: env.YT_CLIENT_ID, client_secret: env.YT_CLIENT_SECRET, redirect_uri: REDIRECT, grant_type: 'authorization_code' }),
    })).json();
    if (!tok.refresh_token) throw new Error(tok.error_description ?? 'pas de jeton de rafraîchissement');
    const ch = await (await fetch('https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    const title = ch.items?.[0]?.snippet?.title ?? '(chaîne introuvable)';
    let out = fs.readFileSync(ENV, 'utf8').split('\n').filter((l) => !/^YT_REFRESH_TOKEN=/.test(l)).join('\n').replace(/\n*$/, '\n');
    fs.writeFileSync(ENV, out + `YT_REFRESH_TOKEN=${tok.refresh_token}\n`);
    res.end(`Chaîne « ${title} » connectée au CRM. Vous pouvez fermer cet onglet.`);
    console.log(`✅ Chaîne « ${title} » connectée : jeton enregistré dans ${ENV}`);
  } catch (e) {
    res.end(`Erreur : ${e.message}`);
    console.error('Erreur :', e.message);
  }
  server.close();
});
server.listen(PORT, '127.0.0.1', () => {
  console.log('Ouverture de la page d\'autorisation Google…');
  exec(`open "${url}"`);
});
