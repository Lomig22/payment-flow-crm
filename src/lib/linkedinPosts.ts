import Anthropic from '@anthropic-ai/sdk';
import { createHmac, randomBytes } from 'crypto';
import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import { notifyLomig } from '@/lib/linkedin';

// Posts LinkedIn automatiques sur le profil de Lomig (demande du 19/10/2026), via l'API officielle
// « Share on LinkedIn » (aucun navigateur automatisé : le compte a été restreint le 16/10 pour ça).
// LinkedIn inbound (22/10/2026) : Claude écrit 2 posts par jour — une accroche, de la valeur, puis
// « Commente MOT et je t'envoie la ressource » — et la ressource elle-même (page publique /r/<slug>,
// dont Lomig envoie le lien en message privé). Chaque post part avec un selfie de Lomig, choisi à la
// publication. Quelques espaces mal placés (jamais de fautes) donnent un rendu « écrit à la main ».
// Stock : 7 jours d'avance. Publication à l'heure par le VPS (publish-tick, chaque minute).

const db = () => supabase as any;
const MODEL = 'claude-opus-5-5';
const API = 'https://api.linkedin.com';
export const REDIRECT_URI = 'https://payment-flow-crm-delta.vercel.app/api/linkedin/oauth/callback';
const SCOPES = 'openid profile w_member_social';
const DAYS_AHEAD = 7;

// Créneaux (heure de Paris) : 2 posts par jour, tous les jours (LinkedIn inbound, 22/10/2026) ;
// quelques minutes de décalage d'un jour à l'autre
const SLOTS: [number, number][] = [[8, 25], [12, 35]];
export const SITE = 'https://payment-flow-crm-delta.vercel.app';
export const resourceUrl = (slug: string) => `${SITE}/r/${slug}`;

// ── OAuth ──
const sign = (s: string) => createHmac('sha256', process.env.CRON_SECRET ?? 'pf').update(s).digest('hex').slice(0, 24);
export function authUrl(): string {
  const ts = String(Date.now());
  const q = new URLSearchParams({ response_type: 'code', client_id: process.env.LINKEDIN_CLIENT_ID ?? '', redirect_uri: REDIRECT_URI, scope: SCOPES, state: `${ts}.${sign(ts)}` });
  return `https://www.linkedin.com/oauth/v2/authorization?${q}`;
}
export function checkState(state: string | null): boolean {
  const [ts, sig] = String(state ?? '').split('.');
  return !!ts && sig === sign(ts) && Date.now() - Number(ts) < 30 * 60_000;
}
export async function exchangeCode(code: string): Promise<{ name: string }> {
  const r = await fetch('https://www.linkedin.com/oauth/v2/accessToken', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI, client_id: process.env.LINKEDIN_CLIENT_ID ?? '', client_secret: process.env.LINKEDIN_CLIENT_SECRET ?? '' }),
  });
  const tok = await r.json();
  if (!r.ok || !tok.access_token) throw new Error(`LinkedIn : ${tok.error_description ?? tok.error ?? r.status}`);
  const me = await (await fetch(`${API}/v2/userinfo`, { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
  if (!me.sub) throw new Error('Profil LinkedIn introuvable');
  await db().from('linkedin_oauth').upsert({
    id: 1, access_token: tok.access_token, member_urn: `urn:li:person:${me.sub}`, name: me.name ?? null,
    expires_at: new Date(Date.now() + (Number(tok.expires_in) || 60 * 86400) * 1000).toISOString(), reminded_at: null, connected_at: new Date().toISOString(),
  });
  return { name: me.name ?? '' };
}
export async function connection(): Promise<{ connected: boolean; name?: string; expires_at?: string }> {
  const { data } = await db().from('linkedin_oauth').select('name, expires_at').eq('id', 1).maybeSingle();
  return data && new Date(data.expires_at).getTime() > Date.now() ? { connected: true, name: data.name, expires_at: data.expires_at } : { connected: false };
}

// API REST versionnée (LinkedIn-Version AAAAMM, chaque version vit environ un an) : on part du mois
// précédent et on recule tant que LinkedIn répond que la version n'existe pas.
let version: string | null = null;
const months = () => Array.from({ length: 10 }, (_, k) => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1 - k); return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}`; });
async function rest(path: string, token: string, body: unknown): Promise<Response> {
  for (const v of version ? [version] : months()) {
    const r = await fetch(`${API}/rest/${path}`, {
      method: 'POST', body: JSON.stringify(body),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'LinkedIn-Version': v, 'X-Restli-Protocol-Version': '2.0.0' },
    });
    if (r.status === 426 || (r.status === 400 && /version/i.test(await r.clone().text()))) { version = null; continue; }
    version = v;
    return r;
  }
  throw new Error('Aucune version de l\'API LinkedIn acceptée');
}

// Texte « little text » de LinkedIn : ces caractères doivent être échappés, sinon le post est tronqué
const escapeLittle = (s: string) => s.replace(/[\\|{}@[\]()<>#*_~]/g, (c) => `\\${c}`);

async function uploadImage(token: string, owner: string, path: string): Promise<string> {
  const init = await rest('images?action=initializeUpload', token, { initializeUploadRequest: { owner } });
  const j = await init.json();
  if (!init.ok) throw new Error(`Image : ${j.message ?? init.status}`);
  const file = await supabase.storage.from(MEDIA_BUCKET).download(path);
  if (file.error || !file.data) throw new Error('Photo introuvable dans le stockage');
  const up = await fetch(j.value.uploadUrl, { method: 'PUT', headers: { Authorization: `Bearer ${token}` }, body: Buffer.from(await file.data.arrayBuffer()) });
  if (!up.ok) throw new Error(`Envoi de la photo : HTTP ${up.status}`);
  return j.value.image as string;
}

// Selfie du post : choisi à la publication (le moins utilisé, puis le plus ancien), sauf s'il a été fixé à la main
async function pickPhoto(post: any): Promise<any | null> {
  if (post.photo_id) {
    const { data } = await db().from('linkedin_photos').select('*').eq('id', post.photo_id).maybeSingle();
    if (data) return data;
  }
  const { data } = await db().from('linkedin_photos').select('*').order('uses').order('last_used_at', { ascending: true, nullsFirst: true }).limit(1);
  return data?.[0] ?? null;
}

async function publishOne(post: any, auth: any): Promise<void> {
  const photo = await pickPhoto(post);
  if (!photo) throw new Error('Aucun selfie dans le CRM');
  const media = await uploadImage(auth.access_token, auth.member_urn, photo.storage_path);
  await db().from('linkedin_photos').update({ uses: photo.uses + 1, last_used_at: new Date().toISOString() }).eq('id', photo.id);
  await db().from('linkedin_posts').update({ photo_id: photo.id }).eq('id', post.id);
  const r = await rest('posts', auth.access_token, {
    author: auth.member_urn, commentary: escapeLittle(post.body), visibility: 'PUBLIC',
    distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] },
    lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false,
    ...(media ? { content: { media: { id: media } } } : {}),
  });
  if (!r.ok) throw new Error(`LinkedIn ${r.status} : ${(await r.text()).slice(0, 300)}`);
  const urn = r.headers.get('x-restli-id') ?? r.headers.get('x-linkedin-id');
  await db().from('linkedin_posts').update({ status: 'published', post_urn: urn, published_at: new Date().toISOString(), error: null, updated_at: new Date().toISOString() }).eq('id', post.id);
}

// Publie les posts dus (appelé chaque minute par le VPS via publish-tick)
export async function publishDuePosts(): Promise<{ id: string; status: string }[]> {
  const { data: due } = await db().from('linkedin_posts').select('*').eq('status', 'scheduled').lte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(2);
  if (!due?.length) return [];
  const { data: auth } = await db().from('linkedin_oauth').select('*').eq('id', 1).maybeSingle();
  if (!auth || new Date(auth.expires_at).getTime() < Date.now()) return [];   // reconnexion nécessaire : rien ne part
  // Chaque post part avec un selfie de Lomig : sans photo dans le CRM, on attend
  const { count: photos } = await db().from('linkedin_photos').select('id', { count: 'exact', head: true });
  if (!photos) return [];
  const out: { id: string; status: string }[] = [];
  for (const post of due) {
    // Réclamation atomique (plusieurs déclencheurs peuvent passer en même temps)
    const { data: got } = await db().from('linkedin_posts').update({ status: 'publishing', attempts: post.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', post.id).eq('status', 'scheduled').select('id');
    if (!got?.length) continue;
    try {
      await publishOne(post, auth);
      out.push({ id: post.id, status: 'published' });
    } catch (e: any) {
      const failed = post.attempts + 1 >= 3;
      await db().from('linkedin_posts').update({ status: failed ? 'failed' : 'scheduled', error: String(e.message).slice(0, 1000), updated_at: new Date().toISOString() }).eq('id', post.id);
      out.push({ id: post.id, status: failed ? 'failed' : 'retry' });
    }
  }
  return out;
}

// Rappel par mail 5 jours avant l'expiration de la connexion
export async function remindReconnect(): Promise<void> {
  const { data: auth } = await db().from('linkedin_oauth').select('expires_at, reminded_at').eq('id', 1).maybeSingle();
  if (!auth || auth.reminded_at || new Date(auth.expires_at).getTime() - Date.now() > 5 * 86400_000) return;
  await notifyLomig('LinkedIn : reconnexion à faire', [
    `La connexion de ton profil LinkedIn expire le ${new Date(auth.expires_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' })} (règle LinkedIn : 60 jours).`,
    'Sans reconnexion, les posts programmés ne partiront plus. Un clic suffit sur la page Posts LinkedIn du CRM.',
  ], { label: 'Reconnecter LinkedIn', url: 'https://payment-flow-crm-delta.vercel.app/linkedin/posts' });
  await db().from('linkedin_oauth').update({ reminded_at: new Date().toISOString() }).eq('id', 1);
}

// ── Écriture des posts ──
// Instant UTC d'une heure de Paris
function parisInstant(day: string, h: number, m: number): Date {
  const guess = new Date(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const shown = new Date(guess.toLocaleString('en-US', { timeZone: 'Europe/Paris' }));
  const utc = new Date(guess.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(guess.getTime() - (shown.getTime() - utc.getTime()));
}
const parisDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
const hash = (s: string) => { let h = 2166136261; for (const c of s) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

function slotsFor(day: string): Date[] {
  return SLOTS.map(([h, m], k) => parisInstant(day, h, m + (hash(day + k) % 9) - 4));
}

// Rendu « écrit à la main » : 1 à 2 espaces mal placés, hors de la phrase d'accroche, jamais dans un mot
export function humanize(text: string, seed: string): string {
  const lines = text.split('\n');
  const body = lines.slice(1);
  const tricks: ((s: string) => string | null)[] = [
    (s) => (/\w,\s\w/.test(s) ? s.replace(/(\w),\s(\w)/, '$1 , $2') : null),          // espace avant la virgule
    (s) => (/\w \w/.test(s) ? s.replace(/(\w{3,}) (\w{3,})/, '$1  $2') : null),        // double espace
    (s) => (/\w\.\s*$/.test(s) ? s.replace(/(\w)\.\s*$/, '$1 .') : null),              // espace avant le point final
    (s) => (/\w,\s\w/.test(s) ? s.replace(/(\w),\s(\w)/, '$1,$2') : null),             // virgule collée
  ];
  let h = hash(seed), done = 0;
  const want = 1 + (h % 2);
  for (let k = 0; k < body.length * 2 && done < want; k++) {
    const li = (h = Math.imul(h ^ k, 2654435761) >>> 0) % Math.max(1, body.length);
    const t = tricks[(h >>> 8) % tricks.length];
    const res = body[li]?.trim() ? t(body[li]) : null;
    if (res && res !== body[li]) { body[li] = res; done++; }
  }
  return [lines[0], ...body].join('\n');
}

const SCHEMA = {
  type: 'object', additionalProperties: false, required: ['posts'],
  properties: { posts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['topic', 'body', 'keyword', 'resource_title', 'resource_body'], properties: {
    topic: { type: 'string', description: 'Sujet en 3 à 6 mots (pour éviter les répétitions)' },
    body: { type: 'string', description: 'Le post complet, ton parlé et naturel, prêt à publier, qui se termine par le CTA avec le mot-clé' },
    keyword: { type: 'string', description: 'Le mot à commenter, un seul mot en majuscules sans accent (ex. CHECKLIST, GUIDE, SCRIPT)' },
    resource_title: { type: 'string', description: 'Titre de la ressource offerte, 4 à 10 mots (ex. « La checklist des 12 points qui font appeler un client »)' },
    resource_body: { type: 'string', description: 'La ressource complète en Markdown simple (# titres, - listes, 1. étapes, **gras**), 2 500 à 6 000 caractères' },
  } } } },
};

const SYSTEM = `Tu écris les posts LinkedIn de Lomig Guéguéniat, fondateur de Payment Flow, à la première personne, comme s'il les tapait lui-même sur son téléphone entre deux rendez-vous.

À QUI : des dirigeants — patrons de TPE/PME, indépendants, fondateurs, gérants d'agence ou de société de services. Pas spécialement des artisans : parle-leur de leurs sujets à eux (trouver des clients sans y passer ses soirées, automatiser sa visibilité et sa prospection, déléguer à des outils et à l'IA, garder du temps pour son métier, les erreurs de dirigeant qu'on fait tous).
QUI EST LOMIG : il automatise sa propre acquisition (contenus programmés, emails, listes de leads, agents IA) et aide les entreprises à recevoir des demandes de clients en continu. Fait vérifiable utilisable si utile : plus de 250 artisans accompagnés avec Payment Flow.

TON — LE PLUS IMPORTANT : NATUREL. Le post doit sonner comme quelqu'un qui parle, pas comme un formateur.
- Écris comme on parle : phrases courtes, parfois incomplètes, mots du quotidien (« franchement », « en vrai », « bon », « le truc c'est que »), une pointe d'humour ou d'autodérision.
- Un avis assumé, une conviction, un constat — pas un cours. Pas de « Voici la méthode en 5 étapes », pas de « Étape 1 / Jour 2 », pas de titres, pas de flèches ni de puces en série. Au plus une petite liste de 3 éléments, et seulement si elle est naturelle.
- Pas de formules de gourou ni de phrases toutes faites (« dans un monde où », « game changer », « levier », « et vous, qu'en pensez-vous ? »). Pas de majuscules d'emphase, 0 à 2 emoji, aucun hashtag.
- 500 à 1 000 caractères. Aère : une à trois phrases par paragraphe.

HONNÊTETÉ : aucune anecdote, conversation, client, chiffre ou résultat inventé. Pas de « ce matin un client m'a dit… », pas de « j'ai fait x3 ». Tu peux parler de ce que Lomig fait et pense, de constats généraux formulés comme tels (« beaucoup de dirigeants… », « je vois souvent… »), et de raisonnements. Pas de promesse garantie. On vend le résultat, jamais les moyens publicitaires (ne cite pas d'outil pub ni de « campagnes »).

STRUCTURE :
1. Première ligne = l'accroche : une phrase qui arrête le scroll (un avis tranché, un constat qui pique, une question directe). Exemple : « Voici comment j'ai automatisé ma visibilité sur internet. »
2. Le corps : la valeur, dite simplement, avec le raisonnement derrière.
3. La fin, naturelle : « Commente MOT et je t'envoie [la ressource]. » (formulation libre, mot-clé en majuscules, ressource envoyée en message privé). Varie les mots-clés.

LA RESSOURCE (resource_body) : ce que reçoivent ceux qui commentent. Elle tient la promesse du post et vaut plus que lui : guide pas à pas, checklist, modèles de messages à copier, plan d'action, prompts prêts à l'emploi… Ici la structure est bienvenue (Markdown simple : titres, listes, étapes, gras). Ton direct et chaleureux, tutoiement, concret et actionnable tout de suite, signée « Lomig — Payment Flow ». Mêmes règles d'honnêteté : rien d'inventé, pas de lien externe.

Pas de fautes d'orthographe : l'effet « écrit à la main » est ajouté ensuite automatiquement. Chaque post traite un sujet différent des sujets récents qu'on te donne.`;

// Remplit le stock (7 jours d'avance)
export async function fillPosts(): Promise<{ created: number }> {
  const now = Date.now();
  const days = Array.from({ length: DAYS_AHEAD }, (_, k) => parisDay(new Date(now + k * 86400_000)));
  const { data: taken } = await db().from('linkedin_posts').select('scheduled_at').neq('status', 'cancelled').gte('scheduled_at', new Date(now).toISOString());
  const busy = new Set((taken ?? []).map((t: any) => new Date(t.scheduled_at).getTime()));
  const free = days.flatMap(slotsFor).filter((d) => d.getTime() > now + 10 * 60_000 && !busy.has(d.getTime())).slice(0, 2);   // 2 par passage (post + ressource) : l'écriture tient dans le temps d'une fonction Vercel
  if (!free.length) return { created: 0 };

  const [{ data: recent }, { data: notes }] = await Promise.all([
    db().from('linkedin_posts').select('topic, keyword').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(30),
    db().from('linkedin_posts').select('topic, feedback').not('feedback', 'is', null).order('updated_at', { ascending: false }).limit(15),
  ]);
  const prompt = [
    `Écris ${free.length} posts LinkedIn différents.`,
    recent?.length ? `Sujets récents à ne pas répéter (mot-clé utilisé) :\n${recent.map((r: any) => `- ${r.topic}${r.keyword ? ` (${r.keyword})` : ''}`).join('\n')}` : '',
    notes?.length ? `Retours de Lomig sur des posts précédents (à appliquer) :\n${notes.map((n: any) => `- « ${n.topic} » : ${n.feedback}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const response = await new Anthropic().messages.create({
    model: MODEL, max_tokens: 16000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as any } },
    messages: [{ role: 'user', content: prompt }],
  } as any);
  const text = (response.content as any[]).find((b) => b.type === 'text')?.text ?? '{}';
  const posts = (JSON.parse(text).posts ?? []).filter((p: any) => p.body?.trim().length > 200 && p.resource_body?.trim().length > 800 && p.keyword);

  let created = 0;
  for (const [k, p] of posts.slice(0, free.length).entries()) {
    const keyword = String(p.keyword).normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20);
    const slug = `${keyword.toLowerCase()}-${randomBytes(3).toString('hex')}`;
    const { error } = await db().from('linkedin_posts').insert({
      scheduled_at: free[k].toISOString(), topic: String(p.topic).slice(0, 120),
      body: humanize(String(p.body).trim(), free[k].toISOString()), keyword,
      resource_title: String(p.resource_title).slice(0, 160), resource_body: String(p.resource_body).trim(), resource_slug: slug,
    });
    if (!error) created++;
  }
  return { created };
}
