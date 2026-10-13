// Génère un token permanent de la Page Facebook « Payment Flow » pour le cross-post.
// Prérequis dans .env.local : META_APP_ID, META_APP_SECRET, FB_USER_TOKEN (token court
// de l'Explorateur de l'API Graph avec pages_show_list, pages_read_engagement, pages_manage_posts).
// Usage : node scripts/facebook-page-token.mjs   → écrit FB_PAGE_ID et FB_PAGE_TOKEN dans .env.local
import fs from 'fs';

const ENV  = '.env.local';
const env  = Object.fromEntries(fs.readFileSync(ENV, 'utf8').split('\n').filter((l) => l.includes('=')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]));
const need = ['META_APP_ID', 'META_APP_SECRET', 'FB_USER_TOKEN'].filter((k) => !env[k]);
if (need.length) { console.error(`Manque dans ${ENV} : ${need.join(', ')}`); process.exit(1); }

const G = 'https://graph.facebook.com/v23.0';
const get = async (url) => { const r = await fetch(url); const b = await r.json(); if (b.error) throw new Error(b.error.message); return b; };

// 1. Token utilisateur longue durée, 2. tokens de Page (permanents quand ils viennent d'un token longue durée)
const long = await get(`${G}/oauth/access_token?grant_type=fb_exchange_token&client_id=${env.META_APP_ID}&client_secret=${env.META_APP_SECRET}&fb_exchange_token=${env.FB_USER_TOKEN}`);
const { data: pages } = await get(`${G}/me/accounts?fields=id,name,access_token,tasks&access_token=${long.access_token}`);
if (!pages?.length) { console.error('Aucune Page Facebook accessible avec ce token.'); process.exit(1); }
console.log('Pages trouvées :', pages.map((p) => p.name).join(' | '));

const page = pages.find((p) => /payment\s*flow/i.test(p.name)) ?? pages[0];
let out = fs.readFileSync(ENV, 'utf8').split('\n').filter((l) => !/^(FB_PAGE_ID|FB_PAGE_TOKEN)=/.test(l)).join('\n').replace(/\n*$/, '\n');
out += `FB_PAGE_ID=${page.id}\nFB_PAGE_TOKEN=${page.access_token}\n`;
fs.writeFileSync(ENV, out);
console.log(`✅ Page « ${page.name} » (${page.id}) : token enregistré dans ${ENV} (droits : ${(page.tasks ?? []).join(', ')})`);
