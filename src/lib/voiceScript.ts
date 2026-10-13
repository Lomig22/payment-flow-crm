import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';

// Script de la voix off (cahier des charges de Lomig du 09/10/2026) : HOOK (texte exact, tiré
// d'une banque) + CORPS (écrit par Gemini sur un sujet de la banque), annoté phrase par phrase
// avec une intention qui pilote l'intonation ElevenLabs. Le script s'arrête juste avant la fin
// CTA, qui prend le relais.

export type Intention = 'CHOC' | 'GRAVE' | 'SUSPENSE' | 'ENERGIQUE' | 'INSISTANCE' | 'CONFIDENCE' | 'CONCLUSION';
export const INTENTIONS: Intention[] = ['CHOC', 'GRAVE', 'SUSPENSE', 'ENERGIQUE', 'INSISTANCE', 'CONFIDENCE', 'CONCLUSION'];

export interface Sentence { text: string; intention: Intention }

// ─── Banques (texte exact, ne jamais reformuler) ─────────────────────────────

export const HOOKS: Record<string, string> = {
  H1: 'Arrête de faire ça si tu veux signer plus de chantiers.',
  H2: 'Personne ne fait ça, et c\'est pour ça qu\'ils galèrent.',
  H3: 'Si t\'es artisan, regarde ça avant demain.',
  H4: 'Le truc que j\'aurais aimé savoir il y a trois ans.',
  H5: 'Je l\'ai compris trop tard. Toi, tu vas le savoir maintenant.',
  H6: 'Ça m\'a coûté des milliers d\'euros de comprendre ça.',
  H7: 'Les artisans qui débordent de clients font tous ça.',
  H8: 'Arrête tout. Fais ça d\'abord.',
  H9: 'Trois secondes pour comprendre pourquoi t\'as pas de clients.',
  H10: 'Ce que personne ne te dira sur les clients.',
};

export const SUBJECTS: Record<string, { label: string; message: string }> = {
  S1:  { label: 'Répondre au téléphone', message: 'Un client qui tombe sur la messagerie appelle le concurrent suivant. Rappeler en moins de 5 minutes change tout.' },
  S2:  { label: 'Fiche Google', message: 'C\'est la première chose qu\'un client regarde. Photos de chantiers récentes, horaires à jour, réponses aux avis.' },
  S3:  { label: 'Avis clients', message: 'Demander un avis à chaque fin de chantier, le jour même, avec un lien direct. Sans avis récents, tu n\'existes pas.' },
  S4:  { label: 'Prix affichés', message: '« Prix sur devis » fait fuir. Un « à partir de » filtre les curieux et rassure les bons clients.' },
  S5:  { label: 'Photos de chantiers', message: 'Prendre un avant/après sur chaque chantier. C\'est ta meilleure publicité et elle est gratuite.' },
  S6:  { label: 'Relance des devis', message: 'La plupart des devis se signent à la deuxième ou troisième relance. Celui qui ne relance pas laisse le chantier au suivant.' },
  S7:  { label: 'Site internet', message: 'Pas un catalogue, une page qui donne envie d\'appeler. Numéro en gros, réalisations, zone d\'intervention.' },
  S8:  { label: 'Bouche-à-oreille', message: 'Ça marche jusqu\'au jour où ça s\'arrête. Ne pas dépendre d\'un seul canal.' },
  S9:  { label: 'Plateformes de mise en relation', message: 'Tu paies pour un contact partagé avec cinq concurrents. Tu loues des clients au lieu de construire les tiens.' },
  S10: { label: 'Choisir ses chantiers', message: 'Quand les demandes arrivent toutes seules, tu dis non aux mauvais chantiers et tu montes tes prix.' },
  S11: { label: 'Délai de réponse au devis', message: 'Envoyer le devis sous 24 h. Après 48 h, le client a déjà signé ailleurs.' },
  S12: { label: 'Fondations avant visibilité', message: 'Mettre de l\'argent en pub sur une fiche vide et un site sans numéro, c\'est remplir un seau percé.' },
};

// Familles de hooks : sujets compatibles et ce que le corps doit livrer dans les 5 s
const FAMILIES: { hooks: string[]; subjects: string[]; rule: string }[] = [
  { hooks: ['H1', 'H8'], subjects: ['S1', 'S4', 'S6', 'S8', 'S9', 'S11', 'S12'],
    rule: 'Le hook dit « arrête » : nomme l\'erreur TOUT DE SUITE (première phrase du corps), puis dis quoi faire à la place.' },
  { hooks: ['H2', 'H7'], subjects: ['S1', 'S2', 'S3', 'S5', 'S6', 'S11'],
    rule: 'Le hook annonce une action (« personne ne fait ça » / « ils font tous ça ») : nomme l\'action TOUT DE SUITE, puis explique pourquoi ça marche.' },
  { hooks: ['H9'], subjects: ['S1', 'S2', 'S7', 'S12'],
    rule: 'Le hook promet « trois secondes » : la réponse tient en UNE phrase juste après le hook, puis on développe.' },
  { hooks: ['H4', 'H5', 'H6'], subjects: ['S8', 'S9', 'S10', 'S12'],
    rule: 'Mini-histoire à la première personne : ce que je voyais faire, ce que ça coûtait, la leçon. Les phrases d\'histoire ont l\'intention CONFIDENCE.' },
  { hooks: ['H3', 'H10'], subjects: ['S3', 'S4', 'S8', 'S9', 'S10'],
    rule: 'Une vérité directe et un peu dérangeante, sans détour.' },
];

export const PIVOTS = ['Mais.', 'Sauf que.', 'Et c\'est là que ça change.'];
const BANNED = /google\s*ads|meta\s*ads|campagnes?|\bseo\b|algorithmes?|\balgo\b/i;
const MAX_WORDS_PER_SENTENCE = 14;
export const MAX_WORDS_PER_S = 2.8;   // avant accélération
// La voix doit tenir TOUTE la vidéo (demande de Lomig du 09/10/2026) : le corps vise au moins
// 2,4 mots par seconde disponible ; la vitesse de la voix s'ajuste ensuite au montage
export const MIN_WORDS_PER_S = 2.4;

// ─── Rotation (content-media/assets/hooks_log.csv : date, vidéo, hook, sujet) ──

const LOG_PATH = 'assets/hooks_log.csv';

interface LogRow { date: string; video: string; hook: string; subject: string }

async function readLog(): Promise<LogRow[]> {
  const { data } = await supabase.storage.from(MEDIA_BUCKET).download(LOG_PATH);
  if (!data) return [];
  return (await data.text()).trim().split('\n').slice(1).filter(Boolean).map((l) => {
    const [date, video, hook, subject] = l.split(',');
    return { date, video, hook, subject };
  });
}

export async function appendHookLog(video: string, hook: string, subject: string) {
  const rows = await readLog();
  rows.push({ date: new Date().toISOString(), video: video.replace(/[,\n]/g, ' '), hook, subject });
  const csv = ['date,video,hook,sujet', ...rows.map((r) => [r.date, r.video, r.hook, r.subject].join(','))].join('\n') + '\n';
  await supabase.storage.from(MEDIA_BUCKET).upload(LOG_PATH, csv, { contentType: 'text/csv', upsert: true });
}

// Couple hook + sujet : jamais le même hook ni le même sujet que la vidéo précédente, et un
// couple ne revient pas tant que les autres couples compatibles n'ont pas servi.
export async function pickHookAndSubject(): Promise<{ hook: string; subject: string; rule: string }> {
  const log = await readLog();
  const pairs = FAMILIES.flatMap((f) => f.hooks.flatMap((h) => f.subjects.map((s) => ({ hook: h, subject: s, rule: f.rule }))));
  const used = new Map<string, number>();
  for (const r of log) used.set(`${r.hook}|${r.subject}`, (used.get(`${r.hook}|${r.subject}`) ?? 0) + 1);
  const last = log[log.length - 1];
  const notRepeat = pairs.filter((p) => !last || (p.hook !== last.hook && p.subject !== last.subject));
  const pool = notRepeat.length ? notRepeat : pairs;
  const min = Math.min(...pool.map((p) => used.get(`${p.hook}|${p.subject}`) ?? 0));
  const candidates = pool.filter((p) => (used.get(`${p.hook}|${p.subject}`) ?? 0) === min);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

// ─── Écriture du corps (Gemini) ──────────────────────────────────────────────

const GEMINI_MODELS = ['gemini-3.8-flash', 'gemini-3.5-flash', 'gemini-3.1-flash-lite', 'gemini-flash-lite-latest'];

export async function geminiJSON(parts: unknown[], schema: unknown, temperature: number): Promise<any> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY manquante');
  const models = Array.from(new Set([process.env.GEMINI_MODEL, ...GEMINI_MODELS].filter(Boolean) as string[]));
  let lastError = '';
  for (const model of models) {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature },
      }),
      cache: 'no-store',
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) { lastError = `Gemini (${model}) : ${body.error?.message ?? res.status}`; continue; }
    const text = body.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? '').join('');
    try { return JSON.parse(text); } catch { lastError = `Gemini (${model}) : réponse illisible`; }
  }
  throw new Error(lastError || 'Gemini indisponible');
}

const BODY_SCHEMA = {
  type: 'OBJECT',
  required: ['sentences'],
  properties: {
    sentences: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        required: ['text', 'intention'],
        properties: {
          text: { type: 'STRING' },
          intention: { type: 'STRING', enum: INTENTIONS.filter((i) => i !== 'CHOC') },
        },
      },
    },
  },
};

export const countWords = (t: string) => t.replace(/<break\s*\/?>/gi, ' ').split(/\s+/).filter((w) => /[A-Za-zÀ-ÿ0-9]/.test(w)).length;

function bodyPrompt(hook: string, subject: { label: string; message: string }, rule: string, minBodyWords: number, maxBodyWords: number, feedback: string) {
  return `Tu écris le CORPS d'une voix off de reel Instagram pour Lomig, fondateur de Payment Flow, qui aide les artisans du bâtiment à trouver des clients. Lomig le lit avec SA voix.

Le hook (déjà fixé, NE PAS le répéter ni le reformuler) : « ${hook} »
Sujet : ${subject.label}. Message clé à faire passer : ${subject.message}
Ce que le corps doit faire : ${rule} Le corps livre EXACTEMENT ce que le hook promet, dans les 5 premières secondes.

Règles d'écriture :
- Français, tutoiement, phrases courtes, comme Lomig parle. Pas de « bonjour », pas de présentation.
- Au plus ${MAX_WORDS_PER_SENTENCE} mots par phrase.
- Un pivot toutes les 6 à 8 secondes environ (environ toutes les 2 ou 3 phrases), écrit comme une phrase à part entière, exactement l'un de : « Mais. », « Sauf que. », « Et c'est là que ça change. ». Intention SUSPENSE.
- Du concret : chiffres et détails plausibles (« moins de cinq minutes », « deux appels »). Écris les nombres en toutes lettres. N'invente JAMAIS un résultat client précis présenté comme réel.
- Interdit : « Google Ads », « Meta Ads », « campagne », « SEO », « algorithme ». On parle du résultat (téléphone qui sonne, demandes de devis, chantiers signés), jamais des moyens.
- Longueur totale du corps : ENTRE ${minBodyWords} ET ${maxBodyWords} mots. La voix doit occuper toute la vidéo : un corps trop court laisse un blanc. Pour atteindre la longueur, développe le sujet (un exemple concret, une conséquence, une objection et sa réponse), sans délayer ni te répéter.
- La dernière phrase amène naturellement vers un appel à l'action (qui suit et n'est pas à écrire), sans le répéter : intention CONCLUSION. Ce n'est PAS elle-même un appel à l'action : pas d'impératif du type « découvre », « commente », « clique », « contacte-moi », pas de promesse de méthode ou d'offre. C'est un constat qui conclut (ex. : « Le chantier va à celui qui répond le premier. »).
- Pour faire ressortir un chiffre ou un mot clé, tu peux écrire « … » juste avant lui (« moins de… cinq minutes »). Jamais de pause au milieu d'un groupe de sens (entre un article et son nom, un verbe et son complément).
- Ne remplace jamais un point par une virgule : la ponctuation fait respirer la voix.

Intention de chaque phrase :
- GRAVE : énoncé du problème ou de l'erreur (ton posé, sérieux, ça coûte cher)
- SUSPENSE : les pivots
- ENERGIQUE : conseil, solution (vif, assuré)
- INSISTANCE : phrase construite autour d'un chiffre ou d'un détail concret
- CONFIDENCE : mini-histoire à la première personne, sur ce que Lomig a VU chez des artisans (« je voyais des artisans… », « j'en ai vu plein qui… »). N'invente JAMAIS de fait biographique (famille, ancien métier, chiffre d'affaires, client nommé).
- CONCLUSION : la dernière phrase uniquement
${feedback ? `\nLa version précédente a été refusée : ${feedback} Corrige ça.` : ''}`;
}

function validateBody(sentences: Sentence[], minBodyWords: number, maxBodyWords: number): string[] {
  const issues: string[] = [];
  const total = sentences.reduce((n, s) => n + countWords(s.text), 0);
  if (!sentences.length) issues.push('corps vide.');
  if (total > maxBodyWords) issues.push(`${total} mots, maximum ${maxBodyWords}.`);
  if (total < minBodyWords) issues.push(`${total} mots seulement, il en faut au moins ${minBodyWords} pour couvrir toute la vidéo.`);
  for (const s of sentences) {
    if (countWords(s.text) > MAX_WORDS_PER_SENTENCE) issues.push(`phrase de plus de ${MAX_WORDS_PER_SENTENCE} mots : « ${s.text} ».`);
    if (BANNED.test(s.text)) issues.push(`mot interdit dans « ${s.text} ».`);
    if (/\bbonjour\b|\bsalut\b/i.test(s.text)) issues.push('pas de salutation.');
  }
  const last = sentences[sentences.length - 1]?.text ?? '';
  if (/^(découvre|commente|clique|contacte|écris|envoie-moi|abonne|rejoins|télécharge)/i.test(last)) issues.push(`la dernière phrase ne doit pas être un appel à l'action : « ${last} ».`);
  return issues;
}

// Phrase trop longue : coupée en deux à la virgule la plus proche du milieu
function splitLong(s: Sentence): Sentence[] {
  if (countWords(s.text) <= MAX_WORDS_PER_SENTENCE) return [s];
  const commas = Array.from(s.text.matchAll(/,\s/g)).map((m) => m.index!);
  if (!commas.length) return [s];
  const mid = s.text.length / 2;
  const at = commas.reduce((a, b) => (Math.abs(b - mid) < Math.abs(a - mid) ? b : a));
  const a = s.text.slice(0, at).trim() + '.';
  const b = s.text.slice(at + 1).trim();
  return [{ ...s, text: a }, { ...s, text: b.charAt(0).toUpperCase() + b.slice(1) }];
}

export async function writeHookScript(available: number): Promise<{ hook: string; subject: string; sentences: Sentence[] }> {
  const pick = await pickHookAndSubject();
  const hookText = HOOKS[pick.hook];
  const maxBodyWords = Math.max(8, Math.floor(available * MAX_WORDS_PER_S) - countWords(hookText));
  const minBodyWords = Math.max(6, Math.floor(available * MIN_WORDS_PER_S) - countWords(hookText));
  let feedback = '';
  let body: Sentence[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const out = await geminiJSON([{ text: bodyPrompt(hookText, SUBJECTS[pick.subject], pick.rule, minBodyWords, maxBodyWords, feedback) }], BODY_SCHEMA, 0.8);
    body = (out.sentences ?? [])
      .map((s: any) => ({ text: String(s.text ?? '').trim(), intention: INTENTIONS.includes(s.intention) ? s.intention : 'ENERGIQUE' }))
      .filter((s: Sentence) => s.text);
    const issues = validateBody(body, minBodyWords, maxBodyWords);
    if (!issues.length) break;
    feedback = issues.join(' ');
    if (attempt === 2) {
      // Dernier recours : coupe les phrases trop longues et retire les phrases en trop (hors conclusion)
      body = body.flatMap(splitLong).filter((s) => !BANNED.test(s.text));
      while (body.length > 2 && body.reduce((n, s) => n + countWords(s.text), 0) > maxBodyWords) body.splice(body.length - 2, 1);
    }
  }
  if (body.length) body[body.length - 1].intention = 'CONCLUSION';
  return { hook: pick.hook, subject: pick.subject, sentences: [{ text: hookText, intention: 'CHOC' }, ...body] };
}

// Réécriture plus courte d'une phrase qui ne passe pas le contrôle (§ 7.4)
export async function shortenSentence(s: Sentence, context: string): Promise<string> {
  const out = await geminiJSON([{ text:
    `Réécris cette phrase de voix off, plus courte (au moins deux mots de moins), même sens, même ton, tutoiement, sans pause au milieu d'un groupe de sens. Contexte : « ${context} ». Phrase : « ${s.text} ».` }],
    { type: 'OBJECT', required: ['text'], properties: { text: { type: 'STRING' } } }, 0.6);
  return String(out.text ?? s.text).trim() || s.text;
}

// Script annoté, tel qu'il est lu (« [CHOC] Arrête de… »)
export const annotate = (sentences: Sentence[]) => sentences.map((s) => `[${s.intention}] ${s.text}`).join('\n');

// Voix trop courte pour la vidéo : phrases ajoutées AVANT la conclusion, dans la continuité du
// script (même sujet, même ton, sans répétition)
export async function extendBody(sentences: Sentence[], subjectId: string, wordsToAdd: number): Promise<Sentence[]> {
  const subject = SUBJECTS[subjectId];
  const out = await geminiJSON([{ text:
    `Voici une voix off de reel (une phrase par ligne, avec son intention) sur le sujet « ${subject?.label ?? ''} » (${subject?.message ?? ''}) :
${annotate(sentences)}

Elle est trop courte pour la vidéo. Écris ENVIRON ${wordsToAdd} mots de phrases supplémentaires, à insérer juste AVANT la dernière phrase (la conclusion), qui prolongent naturellement le propos : un exemple concret, une conséquence ou une objection et sa réponse. Mêmes règles : tutoiement, phrases de ${MAX_WORDS_PER_SENTENCE} mots au plus, chiffres plausibles en toutes lettres, aucun résultat client précis inventé, pas de « Google Ads », « campagne », « SEO », « algorithme », pas d'appel à l'action, pas de répétition.` }],
    BODY_SCHEMA, 0.7);
  const extra: Sentence[] = (out.sentences ?? [])
    .map((x: any) => ({ text: String(x.text ?? '').trim(), intention: INTENTIONS.includes(x.intention) && x.intention !== 'CONCLUSION' ? x.intention : 'ENERGIQUE' }))
    .filter((x: Sentence) => x.text && !BANNED.test(x.text))
    .flatMap(splitLong);
  return [...sentences.slice(0, -1), ...extra, sentences[sentences.length - 1]];
}
