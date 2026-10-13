import Anthropic from '@anthropic-ai/sdk';
import { capitalizeName, type Question } from '@/lib/linkedin';

// Agent de personnalisation LinkedIn (cahier des charges du 12/10/2026).
// L'IA ne rédige pas le message : elle choisit des éléments (sujet et point d'un post, fait du
// parcours) en citant un extrait mot pour mot de la source. Le code vérifie que l'extrait existe
// bien, assemble le message dans le gabarit exact de la variante et contrôle les règles
// (longueur, phrases, mots interdits…). Au moindre doute : variante suivante, jusqu'à C (modèle).

const MODEL = 'claude-opus-5-5';
const MAX_CHARS = 300;
const POST_MAX_DAYS = 60;

export interface ProfilePost { text: string; age: string | null; age_days: number | null; repost: boolean; url: string | null }
export interface LiProfile {
  name?: string; headline?: string; top?: string; about?: string; experience?: string;
  posts?: ProfilePost[]; activity_url?: string; profile_url?: string; collected_at?: string;
}
export interface AgentOutput {
  message:      string;
  variante:     'A' | 'B' | 'C';
  question:     Question;
  element_cite: string;
  source:       string;
  confiance:    'haute' | 'moyenne' | 'faible';
  raison?:      string;     // pourquoi A ou B a été écartée
}
interface Lead { first_name?: string | null; company?: string | null; job_title?: string | null }

// ── Gabarits ──

export const QUESTIONS: Record<Question, string> = {
  cout_client: 'aujourd\'hui, vous savez combien vous coûte un nouveau client ?',
  regularite:  'vos nouveaux clients arrivent plutôt régulièrement, ou ça dépend beaucoup des périodes ?',
};
const SHORT_QUESTIONS: Record<Question, string> = {
  cout_client: 'vous connaissez votre coût par nouveau client',
  regularite:  'vos nouveaux clients, c\'est plutôt régulier ou en dents de scie',
};
const OPEN = (p: string) => `Bonjour ${p}, merci d'avoir accepté.`;

export function messageA(lead: Lead, q: Question, sujet: string, element: string) {
  return `${OPEN(capitalizeName(lead.first_name))} J'ai lu votre post sur ${sujet}, votre point sur ${element} est très juste. Je suis curieux : ${QUESTIONS[q]}`;
}
export function messageB(lead: Lead, q: Question, fait: string) {
  return `${OPEN(capitalizeName(lead.first_name))} ${upperFirst(fait)}, ce n'est pas rien. Je suis curieux : ${QUESTIONS[q]}`;
}
export function messageC(lead: Lead, q: Question) {
  const p = capitalizeName(lead.first_name);
  const company = (lead.company ?? '').trim();
  const withCompany = `${OPEN(p)} J'ai pris le temps de regarder ce que vous faites chez ${company}, c'est un beau projet. Je suis curieux : ${QUESTIONS[q]}`;
  if (company && withCompany.length <= MAX_CHARS) return withCompany;
  return `${OPEN(p)} J'ai pris le temps de regarder ce que vous faites, c'est un beau projet. Je suis curieux : ${QUESTIONS[q]}`;
}
export function messagePost(lead: Lead, q: Question, sujet: string, element: string) {
  return `${capitalizeName(lead.first_name)}, je viens de voir votre post sur ${sujet}, ${element} m'a fait sourire. Du coup, je repose ma question : ${SHORT_QUESTIONS[q]} ?`;
}

// Relances R1 / R2 / R3 : toujours la question du premier message
export function relanceMessage(stage: 'r1' | 'r2' | 'r3', lead: Lead, q: Question): string {
  const p = capitalizeName(lead.first_name);
  const company = (lead.company ?? '').trim();
  if (stage === 'r1') {
    return q === 'cout_client'
      ? `${p}, je remonte mon message au cas où il serait passé sous la pile. La réponse tient en un mot : vous connaissez votre coût par nouveau client, oui ou non ?`
      : `${p}, je remonte mon message au cas où il serait passé sous la pile. En un mot : vos nouveaux clients, c'est plutôt régulier ou en dents de scie ?`;
  }
  if (stage === 'r2') {
    return q === 'cout_client'
      ? `Je vous pose la question parce que c'est le chiffre qui permet de savoir combien investir pour grandir. Par exemple : savoir qu'avec 10 € vous obtenez une demande, et qu'il en faut 4 pour signer un client. Vous l'avez déjà calculé ${company ? `pour ${company}` : 'pour votre activité'} ?`
      : `Je vous pose la question parce que la plupart des dirigeants avec qui j'échange ont des mois pleins et des mois creux, sans savoir à l'avance lesquels. ${company ? `Chez ${company}` : 'Chez vous'}, c'est plutôt prévisible ?`;
  }
  return `${p}, je ne vais pas vous encombrer davantage. Dernière question : prévoir vos nouveaux clients, c'est un sujet pour vous en ce moment, ou pas du tout ?`;
}

// ── Règles de rédaction ──

const BANNED = [
  /payment\s*flow/i, /marketing/i, /publicit/i, /\bpubs?\b/i, /\bsites?\b/i, /google/i, /\bmeta\b/i,
  /https?:|www\.|\.(fr|com)\b/i, /incroyable/i, /g[ée]nial/i, /inspirant/i, /exceptionnel/i, /extraordinaire/i,
  /je me permets/i, /avez-vous vu mon message/i, /d'o[uù] viennent/i, /quel canal/i,
];
const EMOJI = new RegExp('\\p{Extended_Pictographic}', 'u');

// Liste des règles non respectées par un message (vide = conforme)
export function checkMessage(msg: string, { first }: { first: boolean }): string[] {
  const issues: string[] = [];
  if (msg.length > MAX_CHARS) issues.push(`${msg.length} caractères (300 max)`);
  if (first && (msg.match(/[.?](\s|$)/g) ?? []).length > 3) issues.push('plus de 3 phrases');
  if (msg.includes('!')) issues.push('point d\'exclamation');
  if (EMOJI.test(msg)) issues.push('emoji');
  if (/[«»"“”]/.test(msg)) issues.push('guillemets');
  for (const re of BANNED) if (re.test(msg)) issues.push(`mot interdit (${re.source})`);
  return issues;
}

// Un fragment (sujet, point, fait) doit tenir dans une phrase, sans ponctuation finale
function cleanFragment(s: string | null | undefined): string | null {
  const t = (s ?? '').replace(/\s+/g, ' ').trim().replace(/[.;:,!?]+$/, '');
  if (!t || /[.!?«»"“”]/.test(t)) return null;
  return t;
}
const upperFirst = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

// L'extrait cité par l'IA doit figurer dans la source (comparaison sans casse, accents ni espaces)
const flat = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function quoted(extrait: string | null | undefined, source: string): boolean {
  const e = flat(extrait ?? '');
  return e.length >= 12 && flat(source).includes(e);
}

// « 3 j », « 2 sem. », « 5 mois », « 1 an », « 4 h » → jours
export function ageToDays(age: string | null | undefined): number | null {
  const m = (age ?? '').toLowerCase().match(/(\d+)\s*(min|h|j|d|sem|w|mois|mo|an|ans|yr|y)\b/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2];
  if (unit === 'min' || unit === 'h') return 0;
  if (unit === 'j' || unit === 'd') return n;
  if (unit === 'sem' || unit === 'w') return n * 7;
  if (unit === 'mois' || unit === 'mo') return n * 30;
  return n * 365;
}

// Publications exploitables : pas de simple partage, moins de maxDays jours
export function usablePosts(profile: LiProfile, maxDays = POST_MAX_DAYS): (ProfilePost & { index: number })[] {
  return (profile.posts ?? [])
    .map((p, index) => ({ ...p, index, age_days: p.age_days ?? ageToDays(p.age) }))
    .filter((p) => !p.repost && p.text?.trim() && p.age_days != null && p.age_days < maxDays);
}

// ── Appel à l'IA ──

const SYSTEM = `Tu aides Lomig Guéguéniat à écrire un premier message LinkedIn à un dirigeant de TPE/PME française qui vient d'accepter son invitation. Le seul objectif est d'obtenir une réponse ; on ne vend rien.
Tu ne rédiges PAS le message : tu fournis des éléments qui seront insérés dans des phrases fixes. Tu n'inventes jamais rien : chaque élément doit figurer dans la source, et tu le prouves par un extrait recopié mot pour mot.

Candidat POST (phrase fixe : « J'ai lu votre post sur {sujet}, votre point sur {element} est très juste. ») :
- uniquement un post de la personne (pas un simple partage) qui parle de son activité, de son entreprise, de ses clients, de son métier ou de son secteur ;
- jamais un post politique, religieux, personnel sensible (deuil, santé, séparation) ou polémique ;
- sujet : groupe nominal court en minuscules qui suit naturellement « votre post sur » (ex. « le recrutement de poseurs qualifiés ») ;
- element : groupe nominal court en minuscules qui suit « votre point sur » (ex. « la formation en interne ») ; un point précis du post, reformulé, jamais recopié entre guillemets ;
- pour une relance (phrase fixe : « je viens de voir votre post sur {sujet}, {element} m'a fait sourire »), element doit être un groupe nominal qui se lit bien devant « m'a fait sourire » (ex. « la photo de l'équipe au complet »).

Candidat PROFIL (phrase fixe : « {fait}, ce n'est pas rien. ») :
- un fait concret et vérifiable du profil : création de l'entreprise, ancienneté, reconversion, évolution de poste, spécialité, réalisation ou chiffre de la section Infos ;
- fait : une proposition qui commence par un infinitif ou un groupe nominal et vouvoie si besoin (ex. « Passer de salariée en agence à fondatrice de votre propre cabinet en deux ans », « Diriger la même menuiserie depuis 18 ans ») ; pas de superlatif, pas de supposition sur ses difficultés ou ses besoins.

Règles communes : vouvoiement, pas d'emoji, pas de point d'exclamation, pas de guillemets, aucune mention de marketing, publicité, site, Google, Meta ou Payment Flow. Fragments courts (le message complet ne doit pas dépasser 300 caractères).
Confiance : « haute » si l'élément est clair et sans ambiguïté, « moyenne » s'il faut un peu interpréter, « faible » si tu hésites. En cas de doute, mets null.`;

const SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['post', 'profil'],
  properties: {
    post: {
      type: ['object', 'null'], additionalProperties: false,
      required: ['post_index', 'sujet', 'element', 'extrait', 'confiance'],
      properties: {
        post_index: { type: 'integer' },
        sujet:      { type: 'string' },
        element:    { type: 'string' },
        extrait:    { type: 'string', description: 'Passage du post recopié mot pour mot qui justifie sujet et element' },
        confiance:  { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
      },
    },
    profil: {
      type: ['object', 'null'], additionalProperties: false,
      required: ['fait', 'section', 'extrait', 'confiance'],
      properties: {
        fait:      { type: 'string' },
        section:   { type: 'string', enum: ['titre', 'infos', 'experience'] },
        extrait:   { type: 'string', description: 'Passage du profil recopié mot pour mot qui prouve le fait' },
        confiance: { type: 'string', enum: ['haute', 'moyenne', 'faible'] },
      },
    },
  },
} as const;

interface Candidates {
  post:   { post_index: number; sujet: string; element: string; extrait: string; confiance: string } | null;
  profil: { fait: string; section: 'titre' | 'infos' | 'experience'; extrait: string; confiance: string } | null;
}

async function askClaude(prompt: string): Promise<Candidates> {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY manquante');
  const client = new Anthropic();
  const response = await client.beta.messages.create({
    model:      MODEL,
    max_tokens: 8000,
    betas:      ['server-side-fallback-2026-07-01'],
    fallbacks:  'default',
    thinking:   { type: 'adaptive' },
    output_config: { effort: 'medium', format: { type: 'json_schema', schema: SCHEMA as any } },
    system:     SYSTEM,
    messages:   [{ role: 'user', content: prompt }],
  } as any);
  if (response.stop_reason === 'refusal') throw new Error('Refus du modèle');
  const text = (response.content as any[]).find((b) => b.type === 'text')?.text;
  if (!text) throw new Error('Réponse vide du modèle');
  return JSON.parse(text);
}

const cut = (s: string | undefined, n: number) => (s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);

function promptFor(lead: Lead, profile: LiProfile, posts: (ProfilePost & { index: number })[], relance: boolean): string {
  return [
    relance
      ? 'Relance : seul le candidat POST compte (mets profil à null). Les posts ci-dessous ont été publiés depuis notre dernier message.'
      : 'Premier message : propose si possible un candidat POST et un candidat PROFIL.',
    `Personne : ${lead.first_name ?? ''} — ${lead.job_title ?? ''} — ${lead.company ?? ''}`,
    `TITRE DU PROFIL :\n${cut(profile.top || profile.headline, 600)}`,
    relance ? '' : `INFOS :\n${cut(profile.about, 2500) || '(vide)'}`,
    relance ? '' : `EXPÉRIENCE :\n${cut(profile.experience, 2500) || '(vide)'}`,
    `POSTS (de moins de ${POST_MAX_DAYS} jours, simples partages exclus) :\n`
      + (posts.length ? posts.map((p) => `[post_index ${p.index}] il y a ${p.age}\n${cut(p.text, 1500)}`).join('\n\n') : '(aucun)'),
  ].filter(Boolean).join('\n\n');
}

// ── Premier message ──

export async function writeFirstMessage(lead: Lead, profile: LiProfile, q: Question): Promise<AgentOutput> {
  const posts = usablePosts(profile);
  const reasons: string[] = [];
  let c: Candidates = { post: null, profil: null };
  try {
    c = await askClaude(promptFor(lead, profile, posts, false));
  } catch (e: any) {
    reasons.push(`agent indisponible (${e.message})`);
  }

  // A — post
  if (c.post) {
    const post = posts.find((p) => p.index === c.post!.post_index);
    const sujet = cleanFragment(c.post.sujet), element = cleanFragment(c.post.element);
    const msg = sujet && element ? messageA(lead, q, lowerFirst(sujet), lowerFirst(element)) : '';
    const issues = msg ? checkMessage(msg, { first: true }) : ['fragments invalides'];
    if (!post) reasons.push('A : post introuvable');
    else if (c.post.confiance === 'faible') reasons.push('A : confiance faible');
    else if (!quoted(c.post.extrait, post.text)) reasons.push('A : extrait absent du post');
    else if (issues.length) reasons.push(`A : ${issues.join(', ')}`);
    else {
      return {
        message: msg, variante: 'A', question: q,
        element_cite: `${sujet} — ${element} (« ${cut(c.post.extrait, 200)} »)`,
        source: post.url || profile.activity_url || '', confiance: c.post.confiance as any,
      };
    }
  }

  // B — profil
  if (c.profil) {
    const sourceText = c.profil.section === 'infos' ? profile.about : c.profil.section === 'experience' ? profile.experience : (profile.top || profile.headline);
    const fait = cleanFragment(c.profil.fait);
    const msg = fait ? messageB(lead, q, fait) : '';
    const issues = msg ? checkMessage(msg, { first: true }) : ['fait invalide'];
    if (c.profil.confiance === 'faible') reasons.push('B : confiance faible');
    else if (!quoted(c.profil.extrait, sourceText ?? '')) reasons.push('B : extrait absent du profil');
    else if (issues.length) reasons.push(`B : ${issues.join(', ')}`);
    else {
      const section = { titre: 'titre du profil', infos: 'section Infos', experience: 'expériences' }[c.profil.section];
      return {
        message: msg, variante: 'B', question: q,
        element_cite: `${fait} (« ${cut(c.profil.extrait, 200)} »)`,
        source: `${profile.profile_url ?? ''} — ${section}`.replace(/^ — /, ''), confiance: c.profil.confiance as any,
      };
    }
  }

  // C — modèle
  return {
    message: messageC(lead, q), variante: 'C', question: q,
    element_cite: '', source: '', confiance: 'haute',
    raison: reasons.join(' ; ') || 'ni post ni fait exploitable',
  };
}

// ── Relance « post » : un nouveau post depuis le dernier message remplace la relance prévue ──

export async function writePostRelance(lead: Lead, profile: LiProfile, q: Question, sinceDays: number)
  : Promise<{ message: string; element_cite: string; source: string; confiance: string } | null> {
  const posts = usablePosts(profile, Math.max(0, sinceDays));
  if (!posts.length) return null;
  let c: Candidates;
  try { c = await askClaude(promptFor(lead, profile, posts, true)); } catch { return null; }
  if (!c.post || c.post.confiance === 'faible') return null;
  const post = posts.find((p) => p.index === c.post!.post_index);
  const sujet = cleanFragment(c.post.sujet), element = cleanFragment(c.post.element);
  if (!post || !sujet || !element || !quoted(c.post.extrait, post.text)) return null;
  const message = messagePost(lead, q, lowerFirst(sujet), lowerFirst(element));
  if (checkMessage(message, { first: false }).length) return null;
  return {
    message, confiance: c.post.confiance,
    element_cite: `${sujet} — ${element} (« ${cut(c.post.extrait, 200)} »)`,
    source: post.url || profile.activity_url || '',
  };
}
