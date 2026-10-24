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
const DAYS_AHEAD = 14;   // deux semaines d'avance (10 posts par semaine)

// Créneaux (heure de Paris) : 2 posts par jour, tous les jours (LinkedIn inbound, 22/10/2026) ;
// quelques minutes de décalage d'un jour à l'autre
// 10 posts par semaine (notes de Lomig du 25/10/2026) : du lundi au vendredi, un post « valeur » le matin
// et un post « provoc » le midi, soit 5 + 5. Aucun le week-end.
const SLOTS: [number, number, 'valeur' | 'provoc'][] = [[8, 25, 'valeur'], [12, 35, 'provoc']];
const PENDING_MAX = 20;   // posts à valider en attente (deux semaines) : Claude n'en écrit pas plus tant que Lomig n'a pas validé
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

// Posts en retard de plus de 3 h (profil déconnecté, pas de selfie…) : décalés à la suite du planning,
// sur les créneaux libres, au lieu de partir en rafale dès que la publication redevient possible
async function rescheduleLate(): Promise<number> {
  const { data: late } = await db().from('linkedin_posts').select('id').eq('status', 'scheduled')
    .lt('scheduled_at', new Date(Date.now() - 3 * 3600_000).toISOString()).order('scheduled_at');
  if (!late?.length) return 0;
  const { data: taken } = await db().from('linkedin_posts').select('scheduled_at').in('status', ['scheduled', 'publishing', 'published']).gte('scheduled_at', new Date().toISOString());
  const busy = new Set((taken ?? []).map((t: any) => Math.floor(new Date(t.scheduled_at).getTime() / 3600_000)));
  const free: Date[] = [];
  for (let k = 0; free.length < late.length && k < 60; k++) {
    for (const d of slotsFor(parisDay(new Date(Date.now() + k * 86400_000)))) {
      if (d.getTime() > Date.now() + 10 * 60_000 && !busy.has(Math.floor(d.getTime() / 3600_000))) free.push(d);
    }
  }
  for (const [i, p] of late.entries()) {
    if (!free[i]) break;
    await db().from('linkedin_posts').update({ scheduled_at: free[i].toISOString(), updated_at: new Date().toISOString() }).eq('id', p.id).eq('status', 'scheduled');
  }
  return late.length;
}

// Publie les posts dus (appelé chaque minute par le VPS via publish-tick)
export async function publishDuePosts(): Promise<{ id: string; status: string }[]> {
  await rescheduleLate();
  // Seulement les posts validés par Lomig (25/10/2026)
  const { data: due } = await db().from('linkedin_posts').select('*').eq('status', 'scheduled').not('approved_at', 'is', null).lte('scheduled_at', new Date().toISOString()).order('scheduled_at').limit(2);
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
  const wd = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (wd === 0 || wd === 6) return [];
  return SLOTS.map(([h, m], k) => parisInstant(day, h, m + (hash(day + k) % 9) - 4));
}
const kindOf = (d: Date) => (Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: 'numeric', hour12: false }).format(d)) < 11 ? 'valeur' : 'provoc');

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
  properties: { posts: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['topic', 'body', 'resource_title', 'resource_body'], properties: {
    topic: { type: 'string', description: 'Sujet en 3 à 6 mots (pour éviter les répétitions)' },
    body: { type: 'string', description: 'Le post SANS le CTA final (le CRM l\'ajoute), ton parlé et naturel' },
    resource_title: { type: 'string', description: 'La ressource offerte, 4 à 10 mots, commençant par un déterminant, qui se lit après « je t\'envoie » (ex. « ma checklist pour lancer son activité », « mon organisation de semaine »)' },
    resource_body: { type: 'string', description: 'La ressource complète en Markdown simple (# titres, - listes, 1. étapes, **gras**), 2 500 à 6 000 caractères' },
  } } } },
};

// Faits personnels donnés par Lomig (notes du 25/10/2026) : les seuls que les posts peuvent affirmer sur lui
const FACTS = [
  'Lomig a 24 ans.',
  'Objectif annoncé : 100 000 € de chiffre d\'affaires par mois d\'ici la fin de l\'année (c\'est un objectif, pas un résultat atteint).',
  'Il a décidé de quitter la France.',
  'Il travaille autour de 80 heures par semaine, et l\'assume.',
  'Il est fondateur de Payment Flow : plus de 250 artisans accompagnés.',
  'Il automatise sa propre acquisition : contenus programmés, emails, listes de leads, agents IA.',
];

const SYSTEM = `Tu écris les posts LinkedIn de Lomig Guéguéniat, à la première personne, comme s'il les tapait lui-même sur son téléphone. Lectorat : des dirigeants (TPE/PME, indépendants, fondateurs). Objectif : un maximum de commentaires.

FAITS SUR LOMIG (les seuls que tu peux affirmer sur lui, sans les déformer ni les grossir) :
${FACTS.map((f) => `- ${f}`).join('\n')}
Rien d'autre d'inventé : ni anecdote, ni client, ni chiffre, ni résultat. Un objectif reste un objectif (« je vais faire », « je vise »), jamais « j'ai fait ».

DEUX TYPES DE POSTS (on te dit lequel écrire) :

« provoc » — une prise de position qui fait réagir et débattre.
- Ligne 1 = l'accroche, UNE seule ligne, tranchée, à contre-courant. Exemples de Lomig : « Je travaille 80h par semaine et je trouve ça normal. » / « J'ai 24 ans, je vais faire 100k/mois de CA à la fin de l'année et voici pourquoi j'ai décidé de quitter la France. » / « Arrête de… »
- Puis 3 ou 4 raisons, une par ligne, courtes et percutantes, présentées en liste (- raison).
- Puis une phrase qui assume la position (sans se justifier ni s'excuser).

« valeur » — un contenu utile qui donne envie de récupérer la ressource.
- Ligne 1 = l'accroche, UNE seule ligne : « Voici comment … » ou « Arrête de … » (ou très proche).
- Puis le contenu : 3 ou 4 points concrets, en liste (- point), chacun applicable tout de suite.
- Puis une phrase de conclusion.

CTA : ne l'écris PAS. Le CRM ajoute lui-même la dernière ligne (« Commente GO et je t'envoie [resource_title] gratuitement. », modèle réglé par Lomig). Ton texte s'arrête juste avant, sur la phrase qui assume ou qui conclut, et resource_title doit se lire naturellement après « je t'envoie ».

TON : naturel, direct, parlé, tutoiement. Phrases courtes. Pas de jargon ni de formules de gourou (« game changer », « levier », « dans un monde où »), pas de question finale du type « et vous ? », 0 à 2 emoji, aucun hashtag. 400 à 900 caractères.

LA RESSOURCE (resource_body) : ce que reçoivent ceux qui commentent. Elle tient la promesse du post et va plus loin : guide pas à pas, checklist, modèles à copier, plan d'action, prompts… Markdown simple (titres, listes, étapes, gras), tutoiement, concrète, signée « Lomig — Payment Flow ». Pour un post « provoc », la ressource prolonge le sujet de façon utile (ex. « mon organisation de semaine », « ma checklist pour… »). Rien d'inventé, pas de lien externe.

Pas de fautes d'orthographe : l'effet « écrit à la main » est ajouté ensuite automatiquement. Chaque post traite un sujet différent des sujets récents qu'on te donne.`;

// ── Modèle réglé par Lomig : CTA toujours le même mot, ajouté par le CRM à la fin de chaque post ──
export interface PostSettings { cta_keyword: string; cta_template: string }
export async function postSettings(): Promise<PostSettings> {
  const { data } = await db().from('linkedin_post_settings').select('cta_keyword, cta_template').eq('id', 1).maybeSingle();
  return { cta_keyword: data?.cta_keyword || 'GO', cta_template: data?.cta_template || 'Commente {mot} et je t\'envoie {ressource} gratuitement.' };
}
const lowerFirst = (t: string) => t.trim().replace(/^./, (c) => c.toLowerCase()).replace(/[.!\s]+$/, '');
export const ctaLine = (tpl: PostSettings, resource: string) =>
  tpl.cta_template.replace(/\{mot\}/g, tpl.cta_keyword).replace(/\{ressource\}/g, lowerFirst(resource || 'la ressource'));
// Dernier paragraphe « Commente … » / « Écris … en commentaire » retiré (Claude l'ajoute parfois quand même)
export const stripCta = (body: string) => body.trim().replace(/\n\n(?:[^\n]*\b(?:commente|commentaire)\b[^\n]*)$/i, '').trim();
export const withCta = (body: string, tpl: PostSettings, resource: string) => `${stripCta(body)}\n\n${ctaLine(tpl, resource)}`;

// Remplit le stock (7 jours d'avance)
export async function fillPosts(): Promise<{ created: number }> {
  const now = Date.now();
  const days = Array.from({ length: DAYS_AHEAD }, (_, k) => parisDay(new Date(now + k * 86400_000)));
  const { data: taken } = await db().from('linkedin_posts').select('scheduled_at').neq('status', 'cancelled').gte('scheduled_at', new Date(now).toISOString());
  const busy = new Set((taken ?? []).map((t: any) => new Date(t.scheduled_at).getTime()));
  // Pas plus de PENDING_MAX posts en attente de validation ; 2 par passage (post + ressource : temps d'une fonction Vercel)
  const { count: pending } = await db().from('linkedin_posts').select('id', { count: 'exact', head: true }).eq('status', 'scheduled').is('approved_at', null);
  const room = Math.min(2, PENDING_MAX - (pending ?? 0));
  if (room <= 0) return { created: 0 };
  const free = days.flatMap(slotsFor).filter((d) => d.getTime() > now + 10 * 60_000 && !busy.has(d.getTime())).slice(0, room);
  if (!free.length) return { created: 0 };
  const kinds = free.map(kindOf);

  const [{ data: recent }, { data: notes }] = await Promise.all([
    db().from('linkedin_posts').select('topic, keyword').neq('status', 'cancelled').order('created_at', { ascending: false }).limit(30),
    db().from('linkedin_posts').select('topic, feedback').not('feedback', 'is', null).order('updated_at', { ascending: false }).limit(15),
  ]);
  const prompt = [
    `Écris ${free.length} posts LinkedIn différents, dans cet ordre : ${kinds.map((k, i) => `${i + 1}. un post « ${k} »`).join(', ')}.`,
    recent?.length ? `Sujets récents à ne pas répéter (mot-clé utilisé) :\n${recent.map((r: any) => `- ${r.topic}${r.keyword ? ` (${r.keyword})` : ''}`).join('\n')}` : '',
    notes?.length ? `Retours de Lomig sur des posts précédents (à appliquer) :\n${notes.map((n: any) => `- « ${n.topic} » : ${n.feedback}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n');
  const response = await new Anthropic().messages.create({
    model: MODEL, max_tokens: 16000, system: SYSTEM,
    output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA as any } },
    messages: [{ role: 'user', content: prompt }],
  } as any);
  const text = (response.content as any[]).find((b) => b.type === 'text')?.text ?? '{}';
  const posts = (JSON.parse(text).posts ?? []).filter((p: any) => p.body?.trim().length > 200 && p.resource_body?.trim().length > 800 && p.resource_title);

  const tpl = await postSettings();
  let created = 0;
  for (const [k, p] of posts.slice(0, free.length).entries()) {
    const keyword = tpl.cta_keyword;
    const slug = `${keyword.toLowerCase()}-${randomBytes(3).toString('hex')}`;
    const { error } = await db().from('linkedin_posts').insert({
      scheduled_at: free[k].toISOString(), topic: String(p.topic).slice(0, 120), kind: kinds[k],
      body: withCta(humanize(stripCta(String(p.body)), free[k].toISOString()), tpl, String(p.resource_title)), keyword,
      resource_title: String(p.resource_title).slice(0, 160), resource_body: String(p.resource_body).trim(), resource_slug: slug,
    });
    if (!error) created++;
  }
  return { created };
}
