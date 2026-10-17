import Anthropic from '@anthropic-ai/sdk';
import { createHash } from 'crypto';
import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import { markUploaded } from '@/lib/queueProcess';
import { parisMidnight } from '@/lib/autoSchedule';
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
// Phrases de fin : toujours les mêmes, donc générées une seule fois (cache)
// « Écris DEVIS en commentaire » : « Commente » était entendu « Commande » avec la voix Piper
export const OFFER_VO  = "Écris DEVIS en commentaire : je t'offre ton audit et ton plan d'action pour quinze demandes de devis de plus par mois.";
export const FOLLOW_VO = "Abonne-toi, et écris DEVIS en commentaire pour recevoir ton plan d'action offert.";
// Voix des reels : « local » = Piper sur le VPS (gratuit, sans clé, défaut) ; « cloud » = Google si la
// clé existe, sinon ElevenLabs dans la limite des crédits
const LOCAL_TTS = (process.env.AGENCY_TTS ?? 'local') === 'local';

export type Funnel = 'tofu' | 'mofu' | 'bofu';
const db = () => supabase as any;

// ── Plan du jour (Claude) ──

const TYPES = ['hook', 'point', 'checklist', 'versus', 'number', 'search', 'leads', 'chat', 'notifs', 'calendar', 'cta'] as const;
// Sans types nullables (limite des sorties structurées) : chaîne vide, 0 ou [] = champ absent
const str = { type: 'string' };
const strs = { type: 'array', items: { type: 'string' } };
const SCENE = {
  type: 'object', additionalProperties: false,
  required: ['type', 'kicker', 'text', 'text2', 'num', 'title', 'sub', 'items', 'icon', 'left_label', 'left_items', 'right_label', 'right_items',
    'value', 'prefix', 'suffix', 'label', 'note', 'query', 'business', 'total', 'leads', 'contact', 'messages', 'notifs', 'slots', 'vo'],
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
    contact: str,
    messages: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['from', 'text'], properties: { from: { type: 'string', enum: ['client', 'toi'] }, text: { type: 'string' } } } },
    notifs:   { type: 'array', items: { type: 'object', additionalProperties: false, required: ['title', 'sub'], properties: { title: { type: 'string' }, sub: { type: 'string' } } } },
    slots:    { type: 'array', items: { type: 'object', additionalProperties: false, required: ['day', 'label'], properties: { day: { type: 'integer' }, label: { type: 'string' } } } },
    vo: { ...str, description: 'Phrase dite par la voix off pendant la scène, 4 à 10 mots, nombres écrits en lettres' },
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

FORMAT REEL : l'attention se gagne à la seconde. Rythme très rapide, une idée par scène, une coupe toutes les 2 à 3 secondes. Le reel fait 15 à 25 secondes au total.
- 6 à 8 scènes avant la scène finale (cta).
- Chaque scène a une voix off (vo) : 4 à 10 mots, une seule phrase courte et percutante, à l'oral, qui va avec l'écran. Celle de l'accroche fait 8 mots au plus et doit stopper le pouce (question choc, chiffre, contradiction).
- Au moins 3 scènes visuelles (search, leads, chat, notifs, calendar, checklist, versus, number). Jamais deux scènes point d'affilée.
- Les textes à l'écran sont plus courts que la voix : quelques mots forts.

ENTONNOIR :
- tofu (découverte, viser le « waouh » et les partages) : accroche choc, erreurs, idées reçues, avant/après, astuces surprenantes. Dernière scène : cta en mode follow.
- mofu (éducatif, engagement) : une méthode concrète et applicable, étape par étape, checklist. Dernière scène : cta en mode offer.
- bofu (vente) : le parcours avec Payment Flow (visible → demandes qualifiées → tu restes sur tes chantiers → l'étape supérieure), avec les scènes search, leads, notifs, calendar. Dernière scène : cta en mode offer.

TYPES DE SCÈNES (champs utilisés ; les autres : chaîne vide, 0 ou liste vide) :
- hook : kicker (facultatif, 1 à 3 mots), text (≤ 50 car.), text2 (facultatif, ≤ 40 car., la chute). Toujours en première scène.
- point : kicker (ex. « Erreur 2 / 3 »), num (facultatif, ex. « 02 »), title (≤ 36 car.), sub (facultatif, ≤ 60 car.).
- checklist : kicker (facultatif), title (≤ 32 car.), items (3 ou 4, ≤ 30 car. chacun), icon « ok » (à faire) ou « ko » (à éviter).
- versus : title (≤ 28 car.), left_label / right_label (≤ 16 car., ex. « Aujourd'hui » / « Ce qu'il faut »), left_items et right_items (2 ou 3 chacun, ≤ 28 car.).
- number : kicker (facultatif), value (entier), prefix / suffix (facultatifs, ex. « + », « € », « % »), label (≤ 36 car.), note (obligatoire si le chiffre n'est pas un simple calcul : « Exemple »).
- search : title (≤ 28 car.), query (recherche Google réaliste, ex. « plombier nantes »), business (ex. « Ton entreprise · Plombier »).
- leads : title (≤ 28 car.), total (entier, 8 à 20), leads (exactement 3 : prénom + initiale, projet ≤ 22 car., budget réaliste).
- chat : title (≤ 28 car.), contact (prénom du client), messages (2 à 4 SMS ≤ 55 car., from « client » ou « toi ») : une relance, une réponse rapide, une prise de rendez-vous…
- notifs : title (≤ 28 car.), notifs (2 à 4 notifications : title ≤ 26 car. ex. « Nouvelle demande de devis », sub ≤ 38 car.).
- calendar : title (≤ 28 car.), sub (facultatif), slots (4 à 7 créneaux : day de 0 = lundi à 4 = vendredi, label ≤ 14 car. ex. « Devis cuisine »).
- cta : mode « follow » (tofu) ou « offer » (mofu, bofu). Aucun autre champ ; vo vide (la phrase de fin est fixe).
Dans les textes affichés, entoure UN mot clé par texte d'astérisques pour le colorer (*visible*). Jamais plus d'un par texte.

VOIX OFF (vo) : naturelle à l'oral, tutoiement, nombres en toutes lettres, pas d'abréviation.

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
  const vo = cut(s.vo, 110);
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
    case 'chat': {
      const messages = (Array.isArray(s.messages) ? s.messages : []).slice(0, 4).map((m: any) => ({ from: m?.from === 'toi' ? 'toi' : 'client', text: cut(m?.text, 60) })).filter((m: any) => m.text);
      return s.title && messages.length >= 2 ? { type: 'chat', title: cut(s.title, 36), contact: cut(s.contact, 20), messages, vo } : null;
    }
    case 'notifs': {
      const items = (Array.isArray(s.notifs) ? s.notifs : []).slice(0, 4).map((n: any) => ({ title: cut(n?.title, 28), sub: cut(n?.sub, 40) })).filter((n: any) => n.title);
      return s.title && items.length >= 2 ? { type: 'notifs', title: cut(s.title, 36), items, vo } : null;
    }
    case 'calendar': {
      const slots = (Array.isArray(s.slots) ? s.slots : []).slice(0, 7).map((z: any) => ({ day: Math.max(0, Math.min(4, Number(z?.day) || 0)), label: cut(z?.label, 16) })).filter((z: any) => z.label);
      return s.title && slots.length >= 3 ? { type: 'calendar', title: cut(s.title, 36), sub: cut(s.sub, 60), slots, vo } : null;
    }
    default: return null;
  }
}

export function normalizeReel(r: RawReel): { funnel: Funnel; topic: string; scenes: Record<string, any>[]; caption: string } | null {
  if (!['tofu', 'mofu', 'bofu'].includes(r?.funnel) || !Array.isArray(r.scenes)) return null;
  const body = r.scenes.filter((s) => s?.type !== 'cta').map((s) => toTemplateScene(s, r.funnel)).filter(Boolean).slice(0, 8) as Record<string, any>[];
  // Chaque scène parlée (un reel sans voix ne retient personne), au moins 5 scènes avant la fin
  if (body.length < 5 || body[0].type !== 'hook' || body.some((x) => !x.vo)) return null;
  const cta = r.funnel === 'tofu' ? { type: 'cta', mode: 'follow', keyword: 'DEVIS', vo: FOLLOW_VO } : { type: 'cta', mode: 'offer', keyword: 'DEVIS', vo: OFFER_VO };
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
  const { data: existing } = await db().from('agency_reels').select('funnel').eq('day', day).neq('status', 'failed');
  const have: Record<Funnel, number> = { tofu: 0, mofu: 0, bofu: 0 };
  for (const r of existing ?? []) have[r.funnel as Funnel]++;
  const todo: Funnel[] = [];
  for (const f of DAY_ORDER) { if (have[f] > 0) have[f]--; else todo.push(f); }
  if (!todo.length) return { day, planned: 0, remaining: 0 };
  const batch = todo.slice(0, BATCH);
  const want = (['tofu', 'mofu', 'bofu'] as Funnel[]).map((f) => [f, batch.filter((x) => x === f).length] as const).filter(([, n]) => n > 0);

  const [{ data: history }, { data: reviews }] = await Promise.all([
    db().from('agency_reels').select('topic').order('created_at', { ascending: false }).limit(150),
    db().from('agency_reels').select('funnel, topic, review_status, feedback').not('feedback', 'is', null).order('reviewed_at', { ascending: false }).limit(20),
  ]);
  const notes = (reviews ?? []).map((r: any) => `- ${r.review_status === 'approved' ? 'Validé' : 'Refusé'} (${r.funnel}, « ${r.topic} ») : ${r.feedback}`).join('\n');
  const prompt = `Écris ${want.map(([f, n]) => `${n} reel(s) ${f}`).join(', ')} pour le ${day}.
${notes ? `\nRetours de Lomig sur les reels précédents (à appliquer en priorité) :\n${notes}\n` : ''}

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
    const { error } = await db().from('agency_reels').insert({ account_username: AGENCY_ACCOUNT, day, funnel: r.funnel, topic: r.topic, spec: { scenes: r.scenes }, caption: r.caption, voiced: true });
    if (error) throw new Error(`agency_reels : ${error.message}`);
    planned++;
  }
  return { day, planned, remaining: todo.length - planned };
}

// Stock : garder STOCK_TARGET reels non publiés d'avance (7 jours × 10 créneaux). Un appel écrit au plus
// un lot (4 reels) ; le VPS rappelle tant que `full` est faux.
const STOCK_TARGET = Number(process.env.AGENCY_STOCK_TARGET ?? 70);
export async function fillStock(): Promise<{ stock: number; target: number; planned: number; full: boolean; day?: string }> {
  const { data: rows } = await db().from('agency_reels').select('day, queue_id').neq('status', 'failed').neq('review_status', 'rejected');
  const ids = (rows ?? []).map((r: any) => r.queue_id).filter(Boolean);
  const published = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db().from('content_queue').select('id').in('id', ids.slice(i, i + 200)).in('status', ['published', 'failed']);
    for (const q of data ?? []) published.add(q.id);
  }
  const stock = (rows ?? []).filter((r: any) => !r.queue_id || !published.has(r.queue_id)).length;
  if (stock >= STOCK_TARGET) return { stock, target: STOCK_TARGET, planned: 0, full: true };
  // Jour à compléter : le dernier jour écrit s'il n'a pas ses 10 reels, sinon le lendemain
  const days: string[] = (rows ?? []).map((r: any) => r.day as string).sort();
  const last = days.length ? days[days.length - 1] : parisDay();
  const lastCount = days.filter((d) => d === last).length;
  const next = new Date(Date.parse(`${last}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  const day = lastCount < DAY_ORDER.length ? last : (next < parisDay() ? parisDay() : next);
  const r = await planDay(day);
  return { stock: stock + r.planned, target: STOCK_TARGET, planned: r.planned, full: stock + r.planned >= STOCK_TARGET, day };
}

// ── Voix off (cache + plafond de crédits) ──

const RULES = Object.entries(PRONOUNCE as Record<string, string>).filter(([k]) => !k.startsWith('_'));
const escRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const pronounce = (t: string, rules = RULES) => rules.reduce((x, [k, v]) => x.replace(new RegExp(`(?<![\\p{L}])${escRe(k)}(?![\\p{L}])`, 'giu'), v), t);
// Voix Google (Chirp 3 HD, gratuite jusqu'à 1 million de caractères par mois) dès que la clé est
// configurée ; sinon Anatole sur ElevenLabs, dans la limite des crédits
const GOOGLE_VOICE = process.env.AGENCY_GOOGLE_VOICE ?? 'fr-FR-Chirp3-HD-Charon';
const GOOGLE_RATE = Number(process.env.AGENCY_GOOGLE_RATE ?? 1.12);
const GOOGLE_MONTHLY_CAP = 900_000;   // marge sous le million gratuit
const useGoogle = () => !!process.env.GOOGLE_TTS_API_KEY;
// « devis » : correction propre à ElevenLabs (il lisait « Davis »)
const GOOGLE_RULES = RULES.filter(([k]) => k !== 'devis');
const spoken = (text: string) => (useGoogle() ? pronounce(text, GOOGLE_RULES) : pronounce(text));
const voPath = (text: string) => `agency/vo/${createHash('sha1').update(JSON.stringify(useGoogle()
  ? ['google', GOOGLE_VOICE, GOOGLE_RATE, spoken(text)]
  : [VOICE_ID, TTS_MODEL, VOICE_SETTINGS, spoken(text)])).digest('hex')}.mp3`;
// Coût : crédits ElevenLabs (0,5 par caractère) ou caractères Google
const credits = (text: string) => (useGoogle() ? spoken(text).length : Math.ceil(spoken(text).length * 0.5));

async function cached(path: string): Promise<boolean> {
  const dir = path.slice(0, path.lastIndexOf('/')), name = path.slice(path.lastIndexOf('/') + 1);
  const { data } = await supabase.storage.from(MEDIA_BUCKET).list(dir, { search: name, limit: 1 });
  return !!data?.some((f: any) => f.name === name);
}

// Crédits utilisables aujourd'hui : solde (moins une réserve) réparti jusqu'au renouvellement.
// Les jours sans voix s'accumulent (3 au plus) pour pouvoir payer un reel entier ; on retire ce
// que la fabrique a déjà dépensé aujourd'hui
async function voiceBudgetToday(): Promise<number> {
  if (useGoogle()) {
    const month = parisDay().slice(0, 7);
    const { data } = await db().from('agency_reels').select('voice_credits').gte('day', `${month}-01`).gt('voice_credits', 0);
    return GOOGLE_MONTHLY_CAP - (data ?? []).reduce((n: number, r: any) => n + r.voice_credits, 0);
  }
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '' }, cache: 'no-store' });
  if (!res.ok) return 0;
  const s = await res.json();
  const left = (s.character_limit ?? 0) - (s.character_count ?? 0) - CREDIT_RESERVE;
  const days = s.next_character_count_reset_unix ? Math.max(1, Math.ceil((s.next_character_count_reset_unix * 1000 - Date.now()) / 86_400_000)) : 30;
  const today = parisDay();
  // Dépenses comptées le jour du RENDU (et non du plan : un reel écrit la veille et rendu aujourd'hui
  // échappait au plafond, 16/10/2026)
  const midnight = parisMidnight(new Date()).toISOString();
  const [{ data: spentRows }, { data: last }] = await Promise.all([
    db().from('agency_reels').select('voice_credits').gte('render_started_at', midnight).gt('voice_credits', 0),
    db().from('agency_reels').select('render_started_at').lt('render_started_at', midnight).gt('voice_credits', 0).order('render_started_at', { ascending: false }).limit(1),
  ]);
  const spent = (spentRows ?? []).reduce((n: number, r: any) => n + r.voice_credits, 0);
  const lastDay = last?.[0]?.render_started_at ? parisDay(new Date(last[0].render_started_at)) : null;
  const since = lastDay ? Math.round((Date.parse(today) - Date.parse(lastDay)) / 86_400_000) : 2;
  const perDay = left / days;
  return Math.min(left, Math.floor(perDay * Math.min(3, Math.max(1, since)))) - spent;
}

async function tts(text: string, path: string): Promise<void> {
  if (useGoogle()) {
    const r = await fetch(`https://texttospeech.googleapis.com/v1/text:synthesize?key=${process.env.GOOGLE_TTS_API_KEY}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: { text: spoken(text) }, voice: { languageCode: 'fr-FR', name: GOOGLE_VOICE }, audioConfig: { audioEncoding: 'MP3', speakingRate: GOOGLE_RATE, sampleRateHertz: 44100 } }),
    });
    if (!r.ok) throw new Error(`Google TTS ${r.status} : ${(await r.text()).slice(0, 200)}`);
    const { audioContent } = await r.json();
    const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(audioContent, 'base64'), { contentType: 'audio/mpeg', upsert: true });
    if (error) throw new Error(`Stockage : ${error.message}`);
    return;
  }
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY ?? '', 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: spoken(text), model_id: TTS_MODEL, language_code: 'fr', voice_settings: VOICE_SETTINGS }),
  });
  if (!r.ok) throw new Error(`ElevenLabs ${r.status} : ${(await r.text()).slice(0, 200)}`);
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, Buffer.from(await r.arrayBuffer()), { contentType: 'audio/mpeg', upsert: true });
  if (error) throw new Error(`Stockage : ${error.message}`);
}

// Voix de chaque scène : tout ou rien (un reel à moitié parlé sonne faux). Sans budget : sans voix.
async function prepareVoices(reel: any): Promise<{ urls: Record<number, string>; credits: number }> {
  const scenes: any[] = reel.spec.scenes;
  const lines = scenes.map((s, i) => (s.vo ? { i, text: s.vo as string, path: voPath(s.vo) } : null)).filter(Boolean) as { i: number; text: string; path: string }[];
  if (!lines.length || !(useGoogle() || process.env.ELEVENLABS_API_KEY)) return { urls: {}, credits: 0 };
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
export async function nextJob(): Promise<null | { id: string; funnel: Funnel; data: any; vo: Record<number, string>; tts?: { engine: 'piper'; lines: { i: number; text: string }[] } }> {
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
    // Phrase de fin : toujours la version en vigueur (les reels écrits avant un changement la gardaient)
    const specScenes = row.spec.scenes.map((sc: any) => (sc.type === 'cta' ? { ...sc, vo: sc.mode === 'offer' ? OFFER_VO : FOLLOW_VO } : sc));
    if (row.voiced && LOCAL_TTS) {
      // Voix synthétisée par le VPS (Piper) : on lui transmet les phrases à dire
      const lines = specScenes.map((sc: any, i: number) => (sc.vo ? { i, text: pronounce(sc.vo, GOOGLE_RULES) } : null)).filter(Boolean);
      await db().from('agency_reels').update({ error: null }).eq('id', row.id);
      const scenes = specScenes.map(({ vo: _vo, ...sc }: any) => sc);
      return { id: row.id, funnel: row.funnel, data: { funnel: row.funnel, scenes, music: 'music.mp3' }, vo: {}, tts: { engine: 'piper', lines } };
    }
    if (row.voiced) {
      const v = await prepareVoices(row).catch((e) => ({ urls: {} as Record<number, string>, credits: 0, error: e?.message as string }));
      vo = v.urls;
      // Un reel sans voix ne retient personne : il attend (clé Google ou crédits)
      if (!Object.keys(vo).length) {
        await db().from('agency_reels').update({ status: 'planned', attempts: row.attempts, render_started_at: null, voice_credits: row.voice_credits + v.credits,
          error: (v as any).error ?? 'En attente de voix : clé Google TTS manquante ou crédits ElevenLabs épuisés', updated_at: new Date().toISOString() }).eq('id', row.id);
        return null;
      }
      await db().from('agency_reels').update({ voice_credits: row.voice_credits + v.credits, error: null }).eq('id', row.id);
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
  // Validation automatique (10 reels/jour sans intervention, demande de Lomig du 16/10/2026) : le reel
  // est programmé dès son traitement ; Lomig peut le retirer depuis la page Fabrique avant publication.
  // AGENCY_AUTO_APPROVE=false : retour à la validation manuelle.
  const auto = process.env.AGENCY_AUTO_APPROVE !== 'false';
  await db().from('agency_reels').update({
    status: 'uploaded', error: null, updated_at: new Date().toISOString(),
    ...(auto ? { review_status: 'approved', reviewed_at: new Date().toISOString() } : {}),
  }).eq('id', id).eq('review_status', 'pending');
  await db().from('agency_reels').update({ status: 'uploaded', error: null, updated_at: new Date().toISOString() }).eq('id', id);
}

export async function markFailed(id: string, error: string): Promise<void> {
  const { data: reel } = await db().from('agency_reels').select('attempts').eq('id', id).single();
  await db().from('agency_reels').update({
    status: (reel?.attempts ?? 0) >= MAX_ATTEMPTS ? 'failed' : 'planned', error: error.slice(0, 1000), updated_at: new Date().toISOString(),
  }).eq('id', id);
}

// ── Validation par Lomig (page Fabrique du CRM) ──

export async function reviewReel(id: string, action: 'approve' | 'reject', feedback?: string): Promise<{ scheduled: number }> {
  const { data: reel } = await db().from('agency_reels').select('id, queue_id, account_username').eq('id', id).single();
  if (!reel) throw new Error('Reel introuvable');
  await db().from('agency_reels').update({
    review_status: action === 'approve' ? 'approved' : 'rejected', feedback: feedback?.trim() || null,
    reviewed_at: new Date().toISOString(), updated_at: new Date().toISOString(),
  }).eq('id', id);
  if (action === 'reject') {
    if (reel.queue_id) await db().from('content_queue').update({ status: 'failed', error: `Refusé à la validation${feedback ? ` : ${feedback.trim().slice(0, 300)}` : ''}`, updated_at: new Date().toISOString() })
      .eq('id', reel.queue_id).in('status', ['draft', 'scheduled', 'uploading']);
    return { scheduled: 0 };
  }
  const { autoScheduleDrafts } = await import('@/lib/autoSchedule');
  return { scheduled: await autoScheduleDrafts(reel.account_username, true) };
}

// ── Couvertures standardisées (accroche du reel sur fond de marque), générées par le VPS ──

// Prochain reel de la fabrique, programmé ou en brouillon, sans couverture : son accroche et l'URL
// signée pour déposer l'image
export async function nextCover(): Promise<null | { queue_id: string; tag: string; text: string; upload_url: string }> {
  const { data: rows } = await db().from('agency_reels').select('id, funnel, spec, queue_id').not('queue_id', 'is', null).neq('review_status', 'rejected')
    .order('created_at', { ascending: true }).limit(500);
  const ids = (rows ?? []).map((r: any) => r.queue_id);
  if (!ids.length) return null;
  const todo = new Set<string>();
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await db().from('content_queue').select('id').in('id', ids.slice(i, i + 200)).in('status', ['draft', 'scheduled']).is('cover_url', null);
    for (const q of data ?? []) todo.add(q.id);
  }
  const r = (rows ?? []).find((x: any) => todo.has(x.queue_id));
  if (!r) return null;
  const hook = r.spec?.scenes?.find((x: any) => x.type === 'hook') ?? {};
  const TAG: Record<Funnel, string> = { tofu: 'Astuce artisan', mofu: 'Méthode', bofu: 'Payment Flow' };
  const { data: signed, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(`covers/${r.queue_id}.jpg`, { upsert: true });
  if (error || !signed) throw new Error(error?.message ?? 'Stockage indisponible');
  return { queue_id: r.queue_id, tag: hook.kicker || TAG[r.funnel as Funnel], text: hook.text || hook.text2 || r.spec?.scenes?.[0]?.title || '', upload_url: signed.signedUrl };
}

export async function coverDone(queueId: string): Promise<void> {
  const url = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(`covers/${queueId}.jpg`).data.publicUrl;
  await db().from('content_queue').update({ cover_url: url, updated_at: new Date().toISOString() }).eq('id', queueId);
}
