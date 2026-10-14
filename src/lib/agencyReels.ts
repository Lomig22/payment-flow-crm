import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import { markUploaded } from '@/lib/queueProcess';
import PRONOUNCE from '../../motion/lib/pronounce.json';

// Fabrique de reels du compte agence @paymentflow (sprint48, 14/10/2026).
// Le CRM détient les clés : chaque jour Claude écrit 10 reels (6 TOFU, 3 MOFU, 1 BOFU), les voix
// off sont générées ici (cache dans Storage, plafond de crédits ElevenLabs). Le VPS ne fait que le
// rendu (motion/factory) puis dépose la vidéo dans la file du compte agence, programmée ensuite
// automatiquement sur ses créneaux.

export const AGENCY_ACCOUNT = 'paymentflow';
const MODEL = 'claude-opus-5-5';
const MAX_ATTEMPTS = 3;
const LEASE_MS = 30 * 60_000;
// Voix : Anatole (voix partagée française), modèle flash (0,5 crédit par caractère)
const VOICE_ID = process.env.AGENCY_VOICE_ID ?? 'Jrq4GqCKqYpigdQsZRkP';
const TTS_MODEL = 'eleven_flash_v2_5';
const VOICE_SETTINGS = { stability: 0.45, similarity_boost: 0.8, style: 0.3, speed: 1.12, use_speaker_boost: true };
const CREDIT_RESERVE = Number(process.env.AGENCY_VOICE_RESERVE ?? 500);
// Phrase de fin des reels MOFU/BOFU : toujours la même, donc générée une seule fois (cache)
export const OFFER_VO = "Commente DEVIS : je t'offre un audit gratuit et ton plan d'action concret pour obtenir quinze demandes de devis de plus par mois.";

export type Funnel = 'tofu' | 'mofu' | 'bofu';
const db = () => supabase as any;

// ── Plan du jour (Claude) ──

const TYPES = ['hook', 'point', 'checklist', 'versus', 'number', 'search', 'leads', 'cta'] as const;
// Sans types nullables (limite des sorties structurées) : chaîne vide, 0 ou [] = champ absent
const str = { type: 'string' };
const strs = { type: 'array', items: { type: 'string' } };
const SCENE = {
  type: 'object', additionalProperties: false,
  required: ['type', 'kicker', 'text', 'text2', 'num', 'title', 'sub', 'items', 'icon', 'left_label', 'left_items', 'right_label', 'right_items',
    'value', 'prefix', 'suffix', 'label', 'note', 'query', 'business', 'total', 'leads', 'vo'],
  properties: {
    type: { type: 'string', enum: TYPES as unknown as string[] },
    kicker: str, text: str, text2: str, num: str, title: str, sub: str, items: strs,
    icon: { ...str, description: '« ok » ou « ko »' },
    left_label: str, left_items: strs, right_label: str, right_items: strs,
    value: { type: 'integer' }, prefix: str, suffix: str, label: str, note: str,
    query: str, business: str, total: { type: 'integer' },
    leads: {
      type: 'array',
      items: { type: 'object', additionalProperties: false, required: ['name', 'project', 'budget'], properties: { name: { type: 'string' }, project: { type: 'string' }, budget: { type: 'string' } } },
    },
    vo: { ...str, description: 'Phrase dite par la voix off pendant la scène (MOFU/BOFU), nombres écrits en lettres' },
  },
};
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['reels'],
  properties: {
    reels: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false, required: ['funnel', 'topic', 'scenes', 'caption', 'hashtags'],
        properties: {
          funnel:   { type: 'string', enum: ['tofu', 'mofu', 'bofu'] },
          topic:    { type: 'string', description: 'Sujet en une ligne (sert à ne pas se répéter)' },
          scenes:   { type: 'array', items: SCENE },
          caption:  { type: 'string' },
          hashtags: { type: 'array', items: { type: 'string' } },
        },
      },
    },
  },
};

const SYSTEM = `Tu écris des reels Instagram (vidéos verticales en motion design, 15 à 30 s) pour le compte de l'agence Payment Flow (@paymentflow), fondée par Lomig.

CIBLE : artisans et entreprises du bâtiment et de l'habitat (plombiers, électriciens, cuisinistes, menuisiers, couvreurs, paysagistes, peintres, chauffagistes, maçons…) qui font moins de 10 000 € de chiffre d'affaires par mois. Ils veulent plus de demandes de devis qualifiées chaque mois, sans avoir à s'en occuper, pour rester concentrés sur leur métier, et être plus visibles. Tutoiement, phrases courtes, vocabulaire de chantier, zéro jargon marketing.

CE QUE FAIT PAYMENT FLOW : rendre l'artisan visible là où ses clients le cherchent (Google, fiche Google, publicités, réseaux sociaux), lui apporter des demandes de devis déjà qualifiées (projet, budget, délai), gérer tout le reste (réponses, relances, prises de rendez-vous) pendant qu'il reste sur ses chantiers.

ENTONNOIR :
- tofu (découverte, viser le « waouh » et les clics) : accroche choc, erreurs, idées reçues, avant/après, astuces surprenantes. 4 à 6 scènes. Pas de voix off (vo vide partout). Dernière scène : cta en mode follow.
- mofu (éducatif, engagement) : une méthode concrète et applicable, étape par étape, checklist. 5 à 7 scènes. Voix off sur chaque scène sauf la dernière. Dernière scène : cta en mode offer.
- bofu (vente) : le parcours avec Payment Flow (visible → demandes qualifiées → tu restes sur tes chantiers → l'étape supérieure), en s'appuyant sur les scènes search et leads. 5 à 6 scènes. Voix off sur chaque scène sauf la dernière. Dernière scène : cta en mode offer.

TYPES DE SCÈNES (champs utilisés ; les autres : chaîne vide, 0 ou liste vide) :
- hook : kicker (facultatif, 1 à 3 mots), text (≤ 60 car.), text2 (facultatif, ≤ 45 car., la chute). Toujours en première scène.
- point : kicker (ex. « Erreur 2 / 3 »), num (facultatif, ex. « 02 »), title (≤ 40 car.), sub (facultatif, ≤ 70 car.).
- checklist : kicker (facultatif), title (≤ 36 car.), items (3 ou 4, ≤ 34 car. chacun), icon « ok » (à faire) ou « ko » (à éviter).
- versus : title (≤ 30 car.), left_label / right_label (≤ 16 car., ex. « Aujourd'hui » / « Ce qu'il faut »), left_items et right_items (2 ou 3 chacun, ≤ 30 car.).
- number : kicker (facultatif), value (entier), prefix / suffix (facultatifs, ex. « + », « € », « % »), label (≤ 40 car.), note (obligatoire si le chiffre n'est pas un simple calcul : « Exemple »).
- search : title (≤ 30 car.), sub (facultatif), query (recherche Google réaliste, ex. « plombier nantes »), business (ex. « Ton entreprise · Plombier »).
- leads : title (≤ 30 car.), sub (facultatif), total (entier, 8 à 20), leads (exactement 3 : prénom + initiale, projet ≤ 22 car., budget réaliste).
- cta : mode « follow » (tofu) ou « offer » (mofu, bofu). Aucun autre champ ; vo vide.
Dans les textes affichés, entoure UN mot clé par texte d'astérisques pour le colorer (*visible*). Jamais plus d'un par texte.

VOIX OFF (vo) : une phrase naturelle à l'oral, 6 à 20 mots, qui dit la même idée que l'écran sans forcément le recopier. Nombres en toutes lettres.

RÈGLES ABSOLUES :
- N'invente jamais de statistique, d'étude, de client, de témoignage ni de résultat garanti. Un chiffre n'est permis que comme exemple explicite (note « Exemple ») ou calcul simple et vrai.
- Pas de promesse chiffrée en dehors de l'offre : audit gratuit avec Lomig et plan d'action pour +15 demandes de devis par mois.
- Chaque reel a un sujet différent des autres et de l'historique fourni. Varie les métiers, les angles et les accroches.
- Légende (caption) : 2 ou 3 phrases courtes qui prolongent le reel, puis une ligne « 👉 Commente DEVIS : audit gratuit + ton plan d'action pour +15 demandes de devis par mois. ». Pas de hashtag dans caption. Hashtags : 5 à 8, en minuscules, sans espace, avec #.`;

interface RawScene { [k: string]: any }
interface RawReel { funnel: Funnel; topic: string; scenes: RawScene[]; caption: string; hashtags: string[] }

const cut = (s: any, n: number) => (typeof s === 'string' && s.trim() ? s.trim().slice(0, n) : undefined);
const list = (a: any, n: number, len: number) => (Array.isArray(a) ? a.map((x) => cut(x, len)).filter(Boolean).slice(0, n) as string[] : []);

// Scène au format du gabarit (motion/factory/template), textes bornés
export function toTemplateScene(s: RawScene, funnel: Funnel): Record<string, any> | null {
  const vo = funnel === 'tofu' ? undefined : cut(s.vo, 160);
  switch (s.type) {
    case 'hook':      return s.text ? { type: 'hook', kicker: cut(s.kicker, 24), text: cut(s.text, 70), text2: cut(s.text2, 55), vo } : null;
    case 'point':     return s.title ? { type: 'point', kicker: cut(s.kicker, 24), num: cut(s.num, 3), title: cut(s.title, 48), sub: cut(s.sub, 80), vo } : null;
    case 'checklist': { const items = list(s.items, 4, 40); return s.title && items.length >= 2 ? { type: 'checklist', kicker: cut(s.kicker, 28), title: cut(s.title, 44), items, icon: s.icon === 'ko' ? 'ko' : 'ok', vo } : null; }
    case 'versus':    { const l = list(s.left_items, 3, 36), r = list(s.right_items, 3, 36); return s.title && l.length && r.length ? { type: 'versus', title: cut(s.title, 36), left: { label: cut(s.left_label, 18) ?? 'Avant', items: l }, right: { label: cut(s.right_label, 18) ?? 'Après', items: r }, vo } : null; }
    case 'number':    return Number.isInteger(s.value) && s.label ? { type: 'number', kicker: cut(s.kicker, 24), value: Math.max(0, Math.min(999_999, s.value)), prefix: cut(s.prefix, 2), suffix: cut(s.suffix, 3), label: cut(s.label, 48), note: cut(s.note, 50), vo } : null;
    case 'search':    return s.title && s.query ? { type: 'search', title: cut(s.title, 36), sub: cut(s.sub, 60), query: cut(s.query, 26), business: cut(s.business, 34), vo } : null;
    case 'leads': {
      const leads = (Array.isArray(s.leads) ? s.leads : []).slice(0, 3).map((l: any) => ({ name: cut(l?.name, 16), project: cut(l?.project, 24), budget: cut(l?.budget, 10) })).filter((l: any) => l.name && l.project);
      return s.title && leads.length === 3 ? { type: 'leads', title: cut(s.title, 36), sub: cut(s.sub, 60), total: Math.max(3, Math.min(30, Number(s.total) || 12)), items: leads, vo } : null;
    }
    default: return null;
  }
}

export function normalizeReel(r: RawReel): { funnel: Funnel; topic: string; scenes: Record<string, any>[]; caption: string } | null {
  if (!['tofu', 'mofu', 'bofu'].includes(r?.funnel) || !Array.isArray(r.scenes)) return null;
  const body = r.scenes.filter((s) => s?.type !== 'cta').map((s) => toTemplateScene(s, r.funnel)).filter(Boolean).slice(0, 6) as Record<string, any>[];
  if (body.length < 3 || body[0].type !== 'hook') return null;
  const cta = r.funnel === 'tofu' ? { type: 'cta', mode: 'follow', keyword: 'DEVIS' } : { type: 'cta', mode: 'offer', keyword: 'DEVIS', vo: OFFER_VO };
  const tags = (r.hashtags ?? []).map((h) => '#' + String(h).replace(/^#+/, '').replace(/\s+/g, '').toLowerCase()).filter((h) => h.length > 2).slice(0, 8);
  const caption = `${String(r.caption ?? '').trim()}\n\n${tags.join(' ')}`.trim().slice(0, 2200);
  return { funnel: r.funnel, topic: String(r.topic ?? '').slice(0, 200), scenes: [...body, cta], caption };
}

const parisDay = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);

// Ordre de publication sur la journée : les étapes mélangées (6 TOFU, 3 MOFU, 1 BOFU)
const DAY_ORDER: Funnel[] = ['tofu', 'mofu', 'tofu', 'tofu', 'bofu', 'tofu', 'mofu', 'tofu', 'tofu', 'mofu'];
const BATCH = 4;   // reels écrits par appel (un appel tient dans les 5 min de Vercel)

// Écrit le prochain lot de reels manquants du jour. Idempotent : à rappeler jusqu'à remaining = 0.
export async function planDay(day = parisDay()): Promise<{ day: string; planned: number; remaining: number }> {
  const { data: existing } = await db().from('agency_reels').select('funnel').eq('day', day);
  const have: Record<Funnel, number> = { tofu: 0, mofu: 0, bofu: 0 };
  for (const r of existing ?? []) have[r.funnel as Funnel]++;
  const todo: Funnel[] = [];
  for (const f of DAY_ORDER) { if (have[f] > 0) have[f]--; else todo.push(f); }
  if (!todo.length) return { day, planned: 0, remaining: 0 };
  const batch = todo.slice(0, BATCH);
  const want = (['tofu', 'mofu', 'bofu'] as Funnel[]).map((f) => [f, batch.filter((x) => x === f).length] as const).filter(([, n]) => n > 0);

  const { data: history } = await db().from('agency_reels').select('topic').order('created_at', { ascending: false }).limit(150);
  const prompt = `Écris ${want.map(([f, n]) => `${n} reel(s) ${f}`).join(', ')} pour le ${day}.

Sujets déjà traités (ne pas reprendre) :
${(history ?? []).map((h: any) => `- ${h.topic}`).join('\n') || '(aucun)'}`;

  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante');
  const response = await new Anthropic().beta.messages.stream({
    model:      MODEL,
    max_tokens: 16000,
    betas:      ['server-side-fallback-2026-07-01'],
    fallbacks:  'default',
    thinking:   { type: 'adaptive' },
    output_config: { effort: 'low', format: { type: 'json_schema', schema: PLAN_SCHEMA as any } },
    system:     SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  } as any).finalMessage();
  if (response.stop_reason === 'refusal') throw new Error('Refus du modèle');
  const text = (response.content as any[]).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Réponse vide du modèle');
  const reels: RawReel[] = JSON.parse(text).reels ?? [];

  // Dans l'ordre de la journée, sans dépasser ce qui manque par étape
  const pool = reels.map(normalizeReel).filter(Boolean) as NonNullable<ReturnType<typeof normalizeReel>>[];
  let planned = 0;
  for (const f of batch) {
    const i = pool.findIndex((r) => r.funnel === f);
    if (i < 0) continue;
    const [r] = pool.splice(i, 1);
    const { error } = await db().from('agency_reels').insert({ account_username: AGENCY_ACCOUNT, day, funnel: r.funnel, topic: r.topic, spec: { scenes: r.scenes }, caption: r.caption, voiced: r.funnel !== 'tofu' });
    if (error) throw new Error(`agency_reels : ${error.message}`);
    planned++;
  }
  return { day, planned, remaining: todo.length - planned };
}

// ── Voix off (cache + plafond de crédits) ──

const RULES = Object.entries(PRONOUNCE as Record<string, string>).filter(([k]) => !k.startsWith('_'));
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const pronounce = (t: string) => RULES.reduce((x, [k, v]) => x.replace(new RegExp(`(?<![\\p{L}])${escRe(k)}(?![\\p{L}])`, 'giu'), v), t);
const voPath = (text: string) => `agency/vo/${createHash('sha1').update(JSON.stringify([VOICE_ID, TTS_MODEL, VOICE_SETTINGS, pronounce(text)])).digest('hex')}.mp3`;
const credits = (text: string) => Math.ceil(pronounce(text).length * 0.5);

async function cached(path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1);
  const { data } = await supabase.storage.from(MEDIA_BUCKET).list(dir, { search: name, limit: 1 });
  return !!data?.some((f: any) => f.name === name);
}

// Crédits utilisables aujourd'hui : solde (moins une réserve) réparti jusqu'au renouvellement,
// moins ce que la fabrique a déjà dépensé aujourd'hui
async function voiceBudgetToday(): Promise<number> {
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '' }, cache: 'no-store' });
  if (!res.ok) return 0;
  const s = await res.json();
  const left = (s.character_limit ?? 0) - (s.character_count ?? 0) - CREDIT_RESERVE;
  const days = s.next_character_count_reset_unix ? Math.max(1, Math.ceil((s.next_character_count_reset_unix * 1000 - Date.now()) / 86_400_000)) : 30;
  const { data } = await db().from('agency_reels').select('voice_credits').eq('day', parisDay()).gt('voice_credits', 0);
  const spent = (data ?? []).reduce((n: number, r: any) => n + r.voice_credits, 0);
  return Math.floor(left / days) - spent;
}

async function tts(text: string, path: string): Promise<void> {
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: pronounce(text), model_id: TTS_MODEL, language_code: 'fr', voice_settings: VOICE_SETTINGS }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status} : ${(await r.text()).slice(0, 200)}`);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(await r.arrayBuffer()), { contentType: 'audio/mpeg', upsert: true });
  if (error) throw new Error(`Stockage : ${error.message}`);
}

// Voix de chaque scène : tout ou rien (un reel à moitié parlé sonne faux). Sans budget : sans voix.
async function prepareVoices(reel: any): Promise<{ urls: Record<number, string>; credits: number }> {
  const scenes: any[] = reel.spec.scenes;
  const lines = scenes.map((s, i) => (s.vo ? { i, text: s.vo as string, path: voPath(s.vo) } : null)).filter(Boolean) as { i: number; text: string; path: string }[];
  if (!lines.length || !process.env.ELEVENLABS_API_KEY) return { urls: {}, credits: 0 };
  const missing = [];
  for (const l of lines) if (!(await cached(l.path))) missing.push(l);
  const cost = missing.reduce((n, l) => n + credits(l.text), 0);
  if (cost > 0 && cost > (await voiceBudgetToday())) return { urls: {}, credits: 0 };
  for (const l of missing) await tts(l.text, l.path);
  const urls: Record<number, string> = {};
  for (const l of lines) {
    const { data } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(l.path, 3600);
    if (!data?.signedUrl) return { urls: {}, credits: cost };
    urls[l.i] = data.signedUrl;
  }
  return { urls, credits: cost };
}

// ── Travail du VPS ──

// Prochain reel à rendre (bail de 30 min), avec ses textes et les liens de ses voix
export async function nextJob(): Promise<null | { id: string; funnel: Funnel; data: any; vo: Record<number, string> }> {
  const stale = new Date(Date.now() - LEASE_MS).toISOString();
  const { data: rows } = await db().from('agency_reels').select('*')
    .or(`status.eq.planned,and(status.eq.rendering,render_started_at.lt.${stale})`)
    .order('created_at', { ascending: true }).limit(5);
  for (const row of rows ?? []) {
    if (row.attempts >= MAX_ATTEMPTS) {
      await db().from('agency_reels').update({ status: 'failed', error: row.error ?? 'Rendu interrompu', updated_at: new Date().toISOString() }).eq('id', row.id);
      continue;
    }
    const { data: got } = await db().from('agency_reels')
      .update({ status: 'rendering', render_started_at: new Date().toISOString(), attempts: row.attempts + 1, updated_at: new Date().toISOString() })
      .eq('id', row.id).eq('status', row.status).eq('attempts', row.attempts).select('id');
    if (!got?.length) continue;
    let vo: Record<number, string> = {};
    if (row.voiced) {
      const v = await prepareVoices(row).catch(() => ({ urls: {}, credits: 0 }));
      vo = v.urls;
      await db().from('agency_reels').update({ voiced: Object.keys(vo).length > 0, voice_credits: row.voice_credits + v.credits }).eq('id', row.id);
    }
    // Les textes de voix ne vont pas dans la vidéo
    const scenes = row.spec.scenes.map(({ vo: _vo, ...s }: any) => s);
    return { id: row.id, funnel: row.funnel, data: { funnel: row.funnel, scenes, music: 'music.mp3' }, vo };
  }
  return null;
}

// Entrée dans la file @paymentflow + URL signée pour y déposer la vidéo rendue
export async function uploadUrl(id: string, size: number): Promise<{ upload_url: string; queue_id: string }> {
  const { data: reel } = await db().from('agency_reels').select('id, caption, queue_id, status').eq('id', id).single();
  if (!reel || reel.status !== 'rendering') throw new Error('Reel introuvable ou pas en rendu');
  if (size > 50 * 1_048_576) throw new Error('Vidéo de plus de 50 Mo');
  let queueId = reel.queue_id;
  if (!queueId) {
    const { data: row, error } = await db().from('content_queue').insert({
      account_username: AGENCY_ACCOUNT, format: 'reel', caption: reel.caption, caption_source: 'ai',
      file_name: `fabrique-${id}.mp4`, file_size: size,
    }).select('id').single();
    if (error) throw new Error(error.message);
    queueId = row.id;
    await db().from('agency_reels').update({ queue_id: queueId }).eq('id', id);
  }
  const { data: signed, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(`raw/${queueId}.mp4`, { upsert: true });
  if (error || !signed) throw new Error(error?.message ?? 'Stockage indisponible');
  return { upload_url: signed.signedUrl, queue_id: queueId };
}

// Vidéo déposée : le traitement habituel de la file prend le relais (puis programmation auto)
export async function markDone(id: string): Promise<void> {
  const { data: reel } = await db().from('agency_reels').select('queue_id').eq('id', id).single();
  if (!reel?.queue_id) throw new Error('Aucune entrée de file pour ce reel');
  await markUploaded(reel.queue_id);
  await db().from('agency_reels').update({ status: 'uploaded', error: null, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function markFailed(id: string, error: string): Promise<void> {
  const { data: reel } = await db().from('agency_reels').select('attempts').eq('id', id).single();
  await db().from('agency_reels').update({
    status: (reel?.attempts ?? 0) >= MAX_ATTEMPTS ? 'failed' : 'planned', error: error.slice(0, 1000), updated_at: new Date().toISOString(),
  }).eq('id', id);
}
