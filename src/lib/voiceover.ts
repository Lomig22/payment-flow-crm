import { promises as fs } from 'fs';
import os from 'os';
import { createHash } from 'crypto';
import path from 'path';
import { supabase } from '@/lib/supabase';
import { run, probe } from '@/lib/videoClean';
import { withEndCard, END_CARD_PATH } from '@/lib/endCard';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import {
  writeHookScript, appendHookLog, shortenSentence, extendBody, annotate, geminiJSON, countWords, PIVOTS, HOOKS, SUBJECTS,
  type Sentence, type Intention,
} from '@/lib/voiceScript';
import { transcribe, checkSentence, tokens, same, FILLERS, plannedPauseCheck, type SttWord } from '@/lib/voiceQC';

// Voix off de Lomig sur chaque reel, 100 % automatique (cahier des charges du 09/10/2026).
// Quatre étapes, chacune dans un appel (limite de 300 s de Vercel), enchaînées par le cron :
//   1. script   : analyse du son d'origine + HOOK (banque, rotation) + CORPS (Gemini), annoté
//                 phrase par phrase avec une intention (voiceScript.ts)
//   2. voix     : ElevenLabs phrase par phrase, réglages selon l'intention, texte voisin passé
//                 pour une intonation continue ; chaque phrase est transcrite et contrôlée
//                 (mots, pauses, débit) et régénérée si besoin (voiceQC.ts)
//   3. montage  : voix accélérée ×1,2, pauses entre phrases, son d'origine selon la règle 0,
//                 sous-titres façon fin CTA, puis la fin CTA
//   4. contrôle : transcription du rendu ; un mot hors script et hors CTA = pas de publication
// L'état est rangé dans content_queue.clean_report (`audio`, `vo_base`, `voiceover`) : pas de migration.

export interface AudioAnalysis {
  voice:         boolean;          // quelqu'un parle (voix off, dialogue)
  language:      string | null;    // code ISO
  kind:          string;
  excerpt:       string | null;
  foreign_voice: boolean;          // voix dans une autre langue que le français
  analyzed_at:   string;
}

// Une phrase du script (affichée et modifiable dans le CRM)
export interface VoSegment { text: string; intention: Intention; start?: number; end?: number }

interface VoiceSettings { stability: number; similarity_boost: number; style: number; use_speaker_boost: boolean; speed?: number; seed?: number }

// Prise de voix retenue pour un paragraphe (fichier en cache dans assets/tts-cache)
interface Take {
  key: string; text: string; intention: Intention; duration: number;
  words: { w: string; s: number; e: number }[];
  settings: VoiceSettings; attempts: number; rewritten: boolean; issues: string[]; rate: number;
  pivotStart?: boolean;           // le paragraphe commence par un pivot (« Mais. », « Sauf que. »…)
}

export interface VoiceoverState {
  status:       'script' | 'voicing' | 'voiced' | 'rendering' | 'done' | 'verifying' | 'error' | 'skipped';
  hook?:        string;
  subject?:     string;
  segments:     VoSegment[];
  annotated?:   string;
  model?:       string;
  takes?:       Take[];
  verify?:      { ok: boolean; extra: string[]; transcript: string; at: string } | null;
  partial?:     { prev: string; text: string; next: string; take: Take }[];   // prises validées d'une étape voix interrompue
  block_times?: { start: number; end: number }[];   // position de chaque paragraphe dans le rendu
  autofix?:     number;           // paragraphes refaits après une pause anormale au contrôle du rendu
  updated_at:   string;
  rendered_at?: string;
  render_path?: string;
  error?:       string;
  reused_from?: string;           // voix off reprise d'un autre reel (aucun crédit ElevenLabs)
  rerender?:    boolean;          // remontée plus rapide d'une voix déjà vérifiée (mêmes prises)
}

// Règle 0 (prioritaire) : aucune autre voix que celle de Lomig dans le rendu. Une voix dans la
// vidéo d'origine (voix off, dialogue, chanson à paroles) → toute la piste d'origine est retirée
// (pas de séparation voix/musique possible ici) ; sinon la voix est posée par-dessus le son d'origine.
export function audioPlan(a: AudioAnalysis | null, hasAudio: boolean): { keepOriginal: boolean } {
  if (!hasAudio || !a) return { keepOriginal: false };
  return { keepOriginal: !a.voice && a.kind !== 'paroles_musique' && a.kind !== 'voix_off' && a.kind !== 'dialogue' };
}

interface VoBase { path: string; duration: number }

export const voiceoverEnabled = () => !!process.env.ELEVENLABS_API_KEY && !!process.env.ELEVENLABS_VOICE_ID;
// Mode automatique (cron + blocage de la programmation) : VOICEOVER_AUTO=true sur Vercel
export const voiceoverAuto = () => voiceoverEnabled() && process.env.VOICEOVER_AUTO === 'true';

const db = () => supabase as any;
const tmp = (name: string) => path.join(os.tmpdir(), name);
const FONTS_DIR = path.join(process.cwd(), 'assets', 'fonts');
const TTS_CACHE = 'assets/tts-cache';
// Version de la voix : à changer quand l'échantillon du clone change (le cache est alors ignoré).
// v2 = échantillon réenregistré par Lomig le 09/10/2026 (lecture fluide, sans hésitations)
const VOICE_VERSION = '2';
const MODEL_CHOICE = 'assets/voice-model.json';
const CTA_TRANSCRIPT = 'assets/cta-transcript.json';
// Vitesse de la voix au montage, appliquée APRÈS les pauses du § 7.2 : calculée pour que la voix
// tienne toute la vidéo (09/10/2026), entre ces deux bornes. Plancher relevé à 1,15 le 13/10/2026
// (demande de Lomig : voix trop lente, la rétention chute) ; une voix courte finit simplement avant
// la vidéo. VOICEOVER_MIN_SPEED pour ajuster sans redéploiement de code.
const MIN_SPEED = Number(process.env.VOICEOVER_MIN_SPEED ?? 1.15), MAX_SPEED = 1.38;
// Durée de voix (pauses comprises, avant accélération)
const rawDuration = (takes: Take[]) => takes.reduce((t, k, i) => t + span(k).len + gapAfter(takes, i), 0);
const BUSY = ['voicing', 'rendering', 'verifying'];

export class VoiceoverError extends Error {
  constructor(message: string, public status = 500) { super(message); }
}

async function storageText(p: string): Promise<string | null> {
  const { data } = await supabase.storage.from(MEDIA_BUCKET).download(p);
  return data ? data.text() : null;
}
async function storageFile(p: string, local: string): Promise<boolean> {
  const { data } = await supabase.storage.from(MEDIA_BUCKET).download(p);
  if (!data) return false;
  await fs.writeFile(local, Buffer.from(await data.arrayBuffer()));
  return true;
}

// ─── Analyse du son d'origine ────────────────────────────────────────────────

async function audioPart(video: string, tag: string) {
  const mp3 = tmp(`${tag}-audio.mp3`);
  await run(['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '16000', '-b:a', '32k', mp3]);
  const data = (await fs.readFile(mp3)).toString('base64');
  await fs.rm(mp3, { force: true });
  return { inline_data: { mime_type: 'audio/mp3', data } };
}

const ANALYSIS_SCHEMA = {
  type: 'OBJECT',
  required: ['voice', 'language', 'kind', 'excerpt'],
  properties: {
    voice:    { type: 'BOOLEAN' },
    language: { type: 'STRING', nullable: true },
    kind:     { type: 'STRING', enum: ['voix_off', 'dialogue', 'paroles_musique', 'musique_seule', 'sons_ambiants', 'silence'] },
    excerpt:  { type: 'STRING', nullable: true },
  },
};

export async function analyzeAudio(video: string, tag: string): Promise<AudioAnalysis> {
  if (!(await probe(video)).audio) {
    return { voice: false, language: null, kind: 'silence', excerpt: null, foreign_voice: false, analyzed_at: new Date().toISOString() };
  }
  const out = await geminiJSON([await audioPart(video, tag), { text:
    `Écoute la piste audio de cette vidéo courte (chantier, BTP, déco).
voice : true seulement si une voix humaine PARLE (voix off, commentaire, dialogue) ; des paroles de chanson ne comptent pas.
language : code ISO 639-1 de la langue parlée (fr, en, pt, es…), ou null.
kind : la nature principale de la piste.
excerpt : quelques mots entendus, ou null.` }], ANALYSIS_SCHEMA, 0);
  const language = out.voice ? (out.language ?? null) : null;
  return {
    voice: !!out.voice, language, kind: out.kind ?? 'inconnu', excerpt: out.excerpt ?? null,
    foreign_voice: !!out.voice && language !== 'fr',
    analyzed_at: new Date().toISOString(),
  };
}

// ─── Voix (ElevenLabs) ───────────────────────────────────────────────────────

// § 7.3 : réglages selon l'intention. Stabilité relevée et style baissé par rapport au cahier
// des charges (09/10/2026) : le clone de Lomig ajoutait des « euh » et des hésitations sur les
// réglages expressifs.
const SETTINGS: Record<Intention, { stability: number; style: number; speed: number }> = {
  CHOC:       { stability: 0.50, style: 0.35, speed: 0.95 },   // débit légèrement plus lent
  ENERGIQUE:  { stability: 0.50, style: 0.35, speed: 1.05 },
  GRAVE:      { stability: 0.65, style: 0.15, speed: 0.97 },
  CONCLUSION: { stability: 0.65, style: 0.15, speed: 1.0 },
  SUSPENSE:   { stability: 0.55, style: 0.25, speed: 1.0 },
  INSISTANCE: { stability: 0.55, style: 0.25, speed: 0.93 },
  CONFIDENCE: { stability: 0.60, style: 0.20, speed: 1.0 },
};
// v3 : balises d'émotion à la place des réglages fins (stabilité « Natural »)
const V3_TAGS: Partial<Record<Intention, string>> = { ENERGIQUE: '[excited]', SUSPENSE: '[curious]', CONFIDENCE: '[softly]' };

function settingsFor(intention: Intention, model: string, attempt: number): VoiceSettings {
  const base = SETTINGS[intention];
  // v3 : stabilité fixe (« Natural ») ; c'est la graine qui fait varier une nouvelle prise
  if (model === 'eleven_v3') return { stability: 0.5, similarity_boost: 0.82, style: base.style, use_speaker_boost: true, seed: attempt };
  // Nouvelle prise : stabilité relevée (+0,1 puis +0,2) pour chasser hésitations et coupures
  const jitter = [0, 0.1, 0.2][attempt % 3];
  return { stability: +(base.stability + jitter).toFixed(2), similarity_boost: 0.82, style: base.style, use_speaker_boost: true, speed: base.speed, seed: attempt };
}

// Texte envoyé : micro-pauses « … » → balise <break> (v2) ; balise d'émotion en tête (v3)
function textFor(s: Sentence, model: string): string {
  if (model === 'eleven_v3') return `${V3_TAGS[s.intention] ? `${V3_TAGS[s.intention]} ` : ''}${s.text}`;
  return s.text.replace(/\s*…\s+(?=[A-Za-zÀ-ÿ0-9])/g, '… <break time="0.2s" /> ');
}

// Prononciation : mots que la voix lit mal, réécrits pour ElevenLabs seulement (les sous-titres
// gardent l'orthographe). « prospect » sortait « prospecte » (09/10/2026).
const PRONUNCIATIONS: [RegExp, string][] = [
  [/\bprospects\b/g, 'prospès'], [/\bProspects\b/g, 'Prospès'],
  [/\bprospect\b/g, 'prospè'], [/\bProspect\b/g, 'Prospè'],
];
const pronounce = (t: string) => PRONUNCIATIONS.reduce((x, [re, by]) => x.replace(re, by), t);

// Paragraphes : la voix est générée par paragraphe (et non phrase par phrase) pour une
// intonation continue et moins de raccords audibles (09/10/2026). Le hook est seul ; un pivot
// ouvre un nouveau paragraphe ; 2 phrases et 24 mots au plus (au-delà, le clone hésite).
interface Block { sentences: Sentence[]; text: string; intention: Intention; pivotStart: boolean }
const isPivotSentence = (s: Sentence) => s.intention === 'SUSPENSE' || PIVOTS.includes(s.text.trim());

export function buildBlocks(sentences: Sentence[]): Block[] {
  const groups: Sentence[][] = [];
  sentences.forEach((s, i) => {
    const cur = groups[groups.length - 1];
    const words = cur ? cur.reduce((n, x) => n + countWords(x.text), 0) : 0;
    // 2 phrases au plus (au-delà, le clone hésite), 24 mots au plus
    const full = cur && cur.filter((x) => !isPivotSentence(x)).length >= (isPivotSentence(cur[0]) ? 1 : 2);
    if (i <= 1 || !cur || isPivotSentence(s) || full || words + countWords(s.text) > 24) groups.push([s]);
    else cur.push(s);
  });
  return groups.map((g) => {
    const main = g.filter((x) => !isPivotSentence(x));
    // Intention dominante : la plus fréquente hors pivot (la conclusion l'emporte en fin de script)
    const counts = new Map<Intention, number>();
    for (const x of main) counts.set(x.intention, (counts.get(x.intention) ?? 0) + 1);
    const intention = main.some((x) => x.intention === 'CONCLUSION') ? 'CONCLUSION'
      : Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? g[0].intention;
    return { sentences: g, text: g.map((x) => x.text).join(' '), intention, pivotStart: isPivotSentence(g[0]) && g.length > 1 };
  });
}

// Texte envoyé pour un paragraphe : pause après le pivot, micro-pauses « … », prononciation
export function blockTextFor(b: Block): string {
  return pronounce(b.sentences.map((x, i) => {
    const t = x.text.replace(/\s*…\s+(?=[A-Za-zÀ-ÿ0-9])/g, '… <break time="0.2s" /> ');
    return i === 0 && b.pivotStart ? `${t} <break time="0.3s" />` : t;
  }).join(' '));
}

// Réglages d'un paragraphe : moyenne des réglages de ses phrases (hors pivot)
function blockSettings(b: Block, model: string, attempt: number): VoiceSettings {
  const main = b.sentences.filter((x) => !isPivotSentence(x));
  const list = (main.length ? main : b.sentences).map((x) => settingsFor(x.intention, model, attempt));
  const avg = (f: (v: VoiceSettings) => number) => +(list.reduce((n, v) => n + f(v), 0) / list.length).toFixed(2);
  return { ...list[0], stability: avg((v) => v.stability), style: avg((v) => v.style), ...(list[0].speed ? { speed: avg((v) => v.speed ?? 1) } : {}) };
}

interface Spoken { file: string; duration: number; words: { w: string; s: number; e: number }[] }

async function ttsCall(model: string, text: string, previous: string, next: string, settings: VoiceSettings, out: string): Promise<Spoken> {
  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${process.env.ELEVENLABS_VOICE_ID}/with-timestamps?output_format=mp3_44100_128`,
    {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'xi-api-key': process.env.ELEVENLABS_API_KEY! },
      body: JSON.stringify({
        text, model_id: model,
        voice_settings: { ...settings, seed: undefined },
        seed: settings.seed,
        // Texte voisin : intonation continue d'une phrase à l'autre (pas pris en charge par v3)
        ...(model === 'eleven_v3' ? {} : { previous_text: previous || undefined, next_text: next || undefined }),
      }),
      cache: 'no-store',
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body.detail?.message ?? body.detail?.status ?? JSON.stringify(body.detail ?? body).slice(0, 200);
    throw new VoiceoverError(`ElevenLabs : ${msg}`, res.status === 401 ? 400 : 502);
  }
  await fs.writeFile(out, Buffer.from(body.audio_base64, 'base64'));
  // Mots et minutage (balises <break> et [émotion] écartées) : servent aux sous-titres
  const a = body.alignment ?? body.normalized_alignment;
  const words: Spoken['words'] = [];
  let cur = '', s = 0, e = 0;
  const push = () => { if (cur && !/[<>[\]=]|^\/$/.test(cur)) words.push({ w: cur, s, e }); cur = ''; };
  a.characters.forEach((ch: string, i: number) => {
    if (/\s/.test(ch)) return push();
    if (!cur) s = a.character_start_times_seconds[i];
    cur += ch;
    e = a.character_end_times_seconds[i];
  });
  push();
  return { file: out, duration: a.character_end_times_seconds.at(-1) ?? 0, words };
}

// Avec cache : une prise déjà générée (même modèle, texte, voisins et réglages) ne coûte rien
async function tts(model: string, text: string, previous: string, next: string, settings: VoiceSettings, out: string): Promise<Spoken & { key: string }> {
  const key = createHash('sha1').update(JSON.stringify([process.env.ELEVENLABS_VOICE_ID, VOICE_VERSION, model, text, previous, next, settings])).digest('hex');
  if (await storageFile(`${TTS_CACHE}/${key}.mp3`, out)) {
    const meta = await storageText(`${TTS_CACHE}/${key}.json`);
    if (meta) { const m = JSON.parse(meta); return { key, file: out, duration: m.duration, words: m.words }; }
  }
  let spoken: Spoken | null = null;
  for (let attempt = 0; !spoken; attempt++) {
    try { spoken = await ttsCall(model, text, previous, next, settings, out); }
    catch (e: any) {
      // Offre Starter : 3 requêtes simultanées au plus
      if (attempt >= 4 || !/concurrent|too many|rate|busy/i.test(e.message)) throw e;
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  await Promise.all([
    supabase.storage.from(MEDIA_BUCKET).upload(`${TTS_CACHE}/${key}.mp3`, await fs.readFile(out), { contentType: 'audio/mpeg', upsert: true }),
    supabase.storage.from(MEDIA_BUCKET).upload(`${TTS_CACHE}/${key}.json`, JSON.stringify({ duration: spoken.duration, words: spoken.words }), { contentType: 'application/json', upsert: true }),
  ]);
  return { ...spoken, key };
}

// § 7.4 : une phrase → prise contrôlée. Seuls les défauts nets (mot avalé ou déformé, pause au
// milieu d'un groupe de sens, pause trop longue) déclenchent une nouvelle prise, 2 au plus ;
// un débit hors norme est noté sans être rejoué (crédits limités). Mot toujours avalé après
// 3 prises : la phrase est réécrite plus courte (jamais le hook) et rejouée une fois.
// Économie de crédits (demande de Lomig du 09/10/2026) : seuls un « euh », un mot avalé ou
// déformé, ou une pause de plus de 0,6 s font refaire une prise ; une micro-pause est notée
// sans être rejouée (le contrôle du rendu reprend les plus nettes)
const HARD = /hésitation|mots avalés|mots en trop|pause de|coupure|mal prononcé/;

async function voiceBlock(model: string, blocks: Block[], i: number, tag: string, seedBase: number): Promise<Take> {
  const b = blocks[i];
  const prev = blocks[i - 1]?.text ?? '', next = blocks[i + 1]?.text ?? '';
  let best: Take | null = null;
  let attempts = 0;
  const hardCount = (t: Take) => t.issues.filter((x) => HARD.test(x)).length;
  // 2 prises au plus par paragraphe
  for (let a = 0; a < 2; a++) {
    attempts++;
    const settings = blockSettings(b, model, seedBase + a);
    const out = tmp(`${tag}-b${i}-${attempts}.mp3`);
    const spoken = await tts(model, blockTextFor(b), prev, next, settings, out);
    const heard: SttWord[] = await transcribe(out);
    await fs.rm(out, { force: true });
    const qc = checkSentence(b.text, b.intention, heard);
    const take: Take = { key: spoken.key, text: b.text, intention: b.intention, duration: spoken.duration, words: spoken.words,
      settings, attempts, rewritten: false, issues: qc.issues, rate: qc.rate, pivotStart: b.pivotStart };
    if (!best || hardCount(take) < hardCount(best)) best = take;
    if (hardCount(take) === 0) break;
  }
  return { ...best!, attempts };
}

// ─── Choix du modèle (§ 7.3 : test v2 / v3 sur la première vidéo du lot) ──────

async function voiceModel(sentences: Sentence[], tag: string, video: string): Promise<{ model: string; note?: string }> {
  if (process.env.ELEVENLABS_MODEL) return { model: process.env.ELEVENLABS_MODEL };
  const saved = await storageText(MODEL_CHOICE);
  if (saved) return { model: JSON.parse(saved).model };

  // Même début de script dans les deux modèles, contrôlé, puis écouté par Gemini
  const sample = sentences.slice(0, 3);
  const results: Record<string, { file: string; issues: number }> = {};
  for (const model of ['eleven_multilingual_v2', 'eleven_v3']) {
    const files: string[] = [];
    let issues = 0;
    for (let i = 0; i < sample.length; i++) {
      const out = tmp(`${tag}-cmp-${model}-${i}.mp3`);
      const sp = await tts(model, textFor(sample[i], model), sample[i - 1]?.text ?? '', sample[i + 1]?.text ?? '', settingsFor(sample[i].intention, model, 0), out);
      issues += checkSentence(sample[i].text, sample[i].intention, await transcribe(sp.file)).issues.length;
      files.push(out);
    }
    const joined = tmp(`${tag}-cmp-${model}.mp3`);
    await run(['-v', 'error', '-y', ...files.flatMap((f) => ['-i', f]), '-filter_complex', `concat=n=${files.length}:v=0:a=1`, joined]);
    await Promise.all(files.map((f) => fs.rm(f, { force: true })));
    results[model] = { file: joined, issues };
  }
  const read = async (f: string) => ({ inline_data: { mime_type: 'audio/mp3', data: (await fs.readFile(f)).toString('base64') } });
  const judge = await geminiJSON([
    { text: 'Version A :' }, await read(results.eleven_multilingual_v2.file),
    { text: 'Version B :' }, await read(results.eleven_v3.file),
    { text: 'Ces deux versions lisent le même texte français avec la même voix. Laquelle est la plus naturelle (intonation vivante, pauses bien placées, aucune syllabe déformée) ? Réponds A ou B, avec une raison courte.' },
  ], { type: 'OBJECT', required: ['winner', 'reason'], properties: { winner: { type: 'STRING', enum: ['A', 'B'] }, reason: { type: 'STRING' } } }, 0);
  await Promise.all(Object.values(results).map((r) => fs.rm(r.file, { force: true })));
  // Gemini tranche ; un modèle avec nettement plus de défauts au contrôle est écarté
  let model = judge.winner === 'B' ? 'eleven_v3' : 'eleven_multilingual_v2';
  const other = model === 'eleven_v3' ? 'eleven_multilingual_v2' : 'eleven_v3';
  if (results[model].issues > results[other].issues + 1) model = other;
  const choice = { model, decided_at: new Date().toISOString(), video, reason: judge.reason,
    qc_issues: { v2: results.eleven_multilingual_v2.issues, v3: results.eleven_v3.issues } };
  await supabase.storage.from(MEDIA_BUCKET).upload(MODEL_CHOICE, JSON.stringify(choice, null, 2), { contentType: 'application/json', upsert: true });
  return { model, note: `Test v2/v3 : ${model} retenu (${judge.reason} ; défauts v2 ${choice.qc_issues.v2}, v3 ${choice.qc_issues.v3})` };
}

// ─── Montage ─────────────────────────────────────────────────────────────────

const assTime = (t: number) => {
  const cs = Math.max(0, Math.round(t * 100));
  const h = Math.floor(cs / 360000), m = Math.floor((cs % 360000) / 6000), sec = Math.floor((cs % 6000) / 100);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`;
};

// Sous-titres calqués sur le texte de la fin CTA de Lomig (09/10/2026) : Montserrat Bold blanc,
// halo noir large et flou (pas de contour net). Taille : même largeur de texte que dans la fin CTA.
// Placement hors de la zone morte du fil Reels (09/10/2026) : le tiers du bas (nom du profil,
// légende, musique) et la colonne de boutons à droite → bas du texte à 65 % de la hauteur,
// 22 caractères au plus, marges latérales de 15 %.
function buildAss(words: { w: string; s: number; e: number }[], W: number, H: number): string {
  const size = Math.round(H * 0.044);
  const halo = Math.round(size * 0.25), blur = Math.round(size * 0.35);
  const lines: string[] = [];
  for (let i = 0; i < words.length;) {
    const chunk = [words[i++]];
    while (i < words.length && chunk.length < 5 && chunk.map((x) => x.w).join(' ').length + words[i].w.length < 22
      && words[i].s - chunk[chunk.length - 1].e < 0.35
      && !/[.!?…]$/.test(chunk[chunk.length - 1].w)) chunk.push(words[i++]);   // une phrase par sous-titre
    const start = chunk[0].s;
    const end = Math.max(chunk[chunk.length - 1].e, start + 0.3);
    const text = chunk.map((x) => x.w).join(' ').replace(/[{}\\]/g, '');
    lines.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Main,,0,0,0,,{\\blur${blur}}${text}`);
  }
  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${W}
PlayResY: ${H}
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,Montserrat Bold,${size},&H00FFFFFF,&H00FFFFFF,&H20000000,&H00000000,0,0,0,0,100,100,0,0,1,${halo},0,2,${Math.round(W * 0.15)},${Math.round(W * 0.15)},${Math.round(H * 0.35)},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${lines.join('\n')}
`;
}

// § 7.2 : pause après le paragraphe i (avant accélération) — hook 0,4 s ; avant un pivot 0,3 s ;
// sinon 0,2 s (fin de phrase). La pause après un pivot est dans le texte (balise <break>).
function gapAfter(takes: Take[], i: number): number {
  if (i === takes.length - 1) return 0;
  if (i === 0) return 0.4;
  return takes[i + 1].pivotStart ? 0.3 : 0.2;
}

// Partie utile d'une prise : du premier au dernier mot (inspiration de début et souffle de fin
// retirés), avec une petite marge
function span(k: Take): { from: number; to: number; len: number } {
  if (!k.words.length) return { from: 0, to: k.duration, len: k.duration };
  // Marges assez larges pour ne jamais rogner l'attaque du premier mot ni la fin du dernier
  const from = Math.max(0, k.words[0].s - 0.07);
  const to = Math.min(k.duration + 0.3, k.words[k.words.length - 1].e + 0.18);
  return { from, to, len: to - from };
}

async function renderVoiceover(base: string, takes: Take[], analysis: AudioAnalysis | null, tag: string, output: string) {
  const info = await probe(base);
  const duration = info.duration;
  const W = info.width - (info.width % 2), H = info.height - (info.height % 2);

  // Placement à la suite, pauses comprises ; vitesse calculée pour finir juste avant la fin de
  // la vidéo (pas de blanc à la fin)
  const raw = rawDuration(takes);
  const speed = Math.min(MAX_SPEED, Math.max(MIN_SPEED, raw / Math.max(1, duration - 0.3)));
  if (raw / speed > duration + 0.5) throw new VoiceoverError(`Voix trop longue pour la vidéo (${(raw / speed).toFixed(1)} s pour ${duration.toFixed(1)} s) : script à raccourcir`);

  const files = await Promise.all(takes.map(async (k, i) => {
    const f = tmp(`${tag}-t${i}.mp3`);
    if (!(await storageFile(`${TTS_CACHE}/${k.key}.mp3`, f))) throw new VoiceoverError('Voix introuvable dans le cache : relancer l\'étape voix');
    return f;
  }));
  const placed: number[] = [];
  const words: { w: string; s: number; e: number }[] = [];
  let t = 0;
  takes.forEach((k, i) => {
    placed.push(t);
    const { from, len } = span(k);
    // Sous-titres : orthographe du script (la prononciation envoyée à la voix peut différer)
    const display = k.text.split(/\s+/).filter(Boolean);
    const useDisplay = display.length === k.words.length;
    k.words.forEach((w, j) => words.push({ w: useDisplay ? display[j] : w.w, s: t + (w.s - from) / speed, e: t + (w.e - from) / speed }));
    t += (len + gapAfter(takes, i)) / speed;
  });

  const assFile = tmp(`${tag}.ass`);
  await fs.writeFile(assFile, buildAss(words, W, H));
  const plan = audioPlan(analysis, info.audio);

  const st = 'aformat=sample_rates=44100:channel_layouts=stereo';
  const T = duration.toFixed(3);
  // atempo accepte au plus ×2 par filtre : ×1,2 à ×1,38 tient en un seul
  const f: string[] = [`[0:v]scale=${W}:${H},setsar=1,ass=filename=${assFile}:fontsdir=${FONTS_DIR}[vout]`];
  takes.forEach((k, i) => {
    const ms = Math.round(placed[i] * 1000);
    const { from, to, len } = span(k);
    // Coupe au premier et au dernier mot, fondus très courts (pas de clic ni de souffle)
    f.push(`[${i + 1}:a]${st},atrim=start=${from.toFixed(3)}:end=${to.toFixed(3)},asetpts=PTS-STARTPTS,`
      + `afade=t=in:d=0.03,afade=t=out:st=${Math.max(0, len - 0.09).toFixed(3)}:d=0.09,`
      + `atempo=${speed.toFixed(3)},adelay=${ms}|${ms}[v${i}]`);
  });
  // Voix normalisée à un niveau fort et constant (bien au-dessus du son d'origine)
  // (normalisée AVANT le prolongement : après, loudnorm raccourcit la piste à la durée de la voix)
  f.push(`${takes.map((_, i) => `[v${i}]`).join('')}amix=inputs=${takes.length}:normalize=0:duration=longest,loudnorm=I=-14:TP=-1.5:LRA=7,${st},apad,atrim=0:${T}[vo]`);
  if (plan.keepOriginal) {
    // Son d'origine (musique, bruits de chantier) gardé sous la voix, baissé quand Lomig parle
    f.push('[vo]asplit=2[vomain][key]');
    // Son d'origine ramené à un niveau de fond, puis encore baissé pendant que Lomig parle
    f.push(`[0:a]${st},atrim=0:${T},loudnorm=I=-24:TP=-3:LRA=11,${st}[orig]`);
    f.push('[orig][key]sidechaincompress=threshold=0.015:ratio=14:attack=10:release=400:makeup=1[origd]');
    f.push('[vomain][origd]amix=inputs=2:normalize=0:duration=first,alimiter=limit=0.95[aout]');
  } else {
    f.push('[vo]alimiter=limit=0.95[aout]');
  }

  try {
    await run(['-v', 'error', '-y', '-i', base, ...files.flatMap((x) => ['-i', x]),
      '-filter_complex', f.join(';'), '-map', '[vout]', '-map', '[aout]', '-t', T,
      // Version intermédiaire (réencodée avec la fin CTA ensuite) : rapide et quasi sans perte
      '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '14', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', output]);
  } finally {
    await Promise.all([assFile, ...files].map((p) => fs.rm(p, { force: true })));
  }
  return { speed: +speed.toFixed(3), placed, ends: takes.map((k, i) => placed[i] + span(k).len / speed) };
}

// ─── File de publication : état et étapes ────────────────────────────────────

async function loadRow(id: string) {
  const { data: row } = await db().from('content_queue')
    .select('id, format, status, file_name, scheduled_at, storage_path, media_url, clean_report').eq('id', id).single();
  if (!row) throw new VoiceoverError('Contenu introuvable', 404);
  if (row.format !== 'reel') throw new VoiceoverError('Voix off : reels uniquement', 400);
  if (['publishing', 'published'].includes(row.status)) throw new VoiceoverError('Reel déjà publié', 409);
  return row;
}

async function saveReport(id: string, patch: Record<string, unknown>) {
  const { data: row } = await db().from('content_queue').select('clean_report').eq('id', id).single();
  await db().from('content_queue').update({ clean_report: { ...(row?.clean_report ?? {}), ...patch }, updated_at: new Date().toISOString() }).eq('id', id);
}

const saveState = (id: string, state: VoiceoverState) => saveReport(id, { voiceover: { ...state, updated_at: new Date().toISOString() } });

// Un seul traitement à la fois par reel (bouton du CRM + cron)
async function lock(id: string, state: VoiceoverState, busy: VoiceoverState['status']) {
  if (BUSY.includes(state.status) && Date.now() - new Date(state.updated_at).getTime() < 6 * 60_000) {
    throw new VoiceoverError('Traitement déjà en cours pour ce reel : patiente quelques minutes', 409);
  }
  await saveState(id, { ...state, status: busy, error: undefined });
}

// Vidéo de base (sans voix off ni fin CTA). Pour les reels traités avant la voix off, elle est
// reconstituée une fois : la vidéo publiée, moins sa fin CTA.
async function downloadBase(row: any, local: string): Promise<VoBase> {
  const report = row.clean_report ?? {};
  // Base déjà là ; sinon (supprimée par le ménage du stockage), on la reconstitue ci-dessous
  if (report.vo_base?.path && await storageFile(report.vo_base.path, local)) return report.vo_base;
  const full = tmp(`${row.id}-${Date.now()}-full.mp4`);
  if (!(await storageFile(row.storage_path, full))) throw new VoiceoverError('Vidéo introuvable');
  let cut = 0;
  if (report.end_card) {
    const cardFile = tmp(`${row.id}-${Date.now()}-card.mp4`);
    if (await storageFile(END_CARD_PATH, cardFile)) {
      cut = (await probe(cardFile)).duration + 1;   // + END_CARD_HOLD_S
      await fs.rm(cardFile, { force: true });
    }
  }
  const duration = Math.max(1, (await probe(full)).duration - cut);
  await run(['-v', 'error', '-y', '-i', full, '-t', duration.toFixed(3), '-c', 'copy', '-movflags', '+faststart', local]);
  await fs.rm(full, { force: true });
  const basePath = `clean/${row.id}-base.mp4`;
  await supabase.storage.from(MEDIA_BUCKET).upload(basePath, await fs.readFile(local), { contentType: 'video/mp4', upsert: true });
  const vo_base = { path: basePath, duration: (await probe(local)).duration };
  await saveReport(row.id, { vo_base });
  return vo_base;
}

const toSegments = (sentences: Sentence[]): VoSegment[] => sentences.map((s) => ({ text: s.text, intention: s.intention }));

// Étape 1 : analyse du son d'origine + script (hook + corps)
export async function prepareVoiceoverScript(id: string, force = false): Promise<VoiceoverState> {
  const row = await loadRow(id);
  const report = row.clean_report ?? {};
  if (!force && report.voiceover?.segments?.length) return report.voiceover;
  const local = tmp(`${id}-${Date.now()}-base.mp4`);
  try {
    const base = await downloadBase(row, local);
    const audio: AudioAnalysis = report.audio ?? await analyzeAudio(local, id);
    // Temps disponible = durée de la vidéo sans la fin CTA (la base n'en a pas)
    const script = await writeHookScript(base.duration);
    await appendHookLog(row.file_name ?? id, script.hook, script.subject);
    const voiceover: VoiceoverState = {
      status: 'script', hook: script.hook, subject: script.subject,
      segments: toSegments(script.sentences), annotated: annotate(script.sentences), updated_at: new Date().toISOString(),
    };
    await saveReport(id, { audio, voiceover });
    return voiceover;
  } finally {
    await fs.rm(local, { force: true });
  }
}

// Script retouché dans le CRM : le hook reste celui de la banque
export async function saveVoiceoverScript(id: string, raw: VoSegment[]): Promise<VoiceoverState> {
  const row = await loadRow(id);
  const prev: VoiceoverState | undefined = row.clean_report?.voiceover;
  if (!prev?.segments?.length) throw new VoiceoverError('Écrire d\'abord le script', 400);
  const segments = raw.map((s) => ({ text: String(s.text ?? '').trim(), intention: s.intention })).filter((s) => s.text) as VoSegment[];
  if (!segments.length) throw new VoiceoverError('Script vide', 400);
  if (prev.hook) segments[0] = { text: HOOKS[prev.hook], intention: 'CHOC' };
  const voiceover: VoiceoverState = { ...prev, status: 'script', segments, annotated: annotate(segments), takes: undefined, verify: null, error: undefined, updated_at: new Date().toISOString() };
  await saveReport(id, { voiceover });
  return voiceover;
}

// ── Réutilisation d'une voix off déjà générée (13/10/2026) ──
// Les scripts sont génériques (hook + sujet, sans lien avec les images) : une voix off complète et
// vérifiée d'un autre reel est reprise telle quelle (mêmes prises, depuis le cache des voix), sans
// aucun crédit ElevenLabs. Choix : une voix qui tient dans la vidéo entre ×MIN_SPEED et ×MAX_SPEED,
// la moins réutilisée, en évitant les plus récemment reprises.
export async function reuseVoiceover(id: string): Promise<VoiceoverState | null> {
  const row = await loadRow(id);
  const report = row.clean_report ?? {};
  let duration: number = report.vo_base?.duration;
  let audio: AudioAnalysis | null = report.audio ?? null;
  if (!duration || !audio) {
    const local = tmp(`${id}-${Date.now()}-base.mp4`);
    try {
      const base = await downloadBase(row, local);
      duration = base.duration;
      audio = audio ?? await analyzeAudio(local, id);
    } finally {
      await fs.rm(local, { force: true });
    }
  }
  const available = Math.max(1, duration - 0.3);
  const { data } = await db().from('content_queue').select('id, updated_at, clean_report')
    .not('clean_report->voiceover->takes', 'is', null).limit(500);
  const rows = (data ?? []) as any[];
  const usage = new Map<string, number>();
  const recent: string[] = [];
  for (const r of [...rows].sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))) {
    const from = r.clean_report?.voiceover?.reused_from;
    if (from) { usage.set(from, (usage.get(from) ?? 0) + 1); if (recent.length < 8) recent.push(from); }
  }
  const candidates = rows
    .filter((r) => r.id !== id)
    .map((r) => ({ id: r.id as string, vo: r.clean_report.voiceover as VoiceoverState }))
    .filter(({ vo }) => vo.status === 'done' && vo.verify?.ok && vo.takes?.length && !vo.reused_from && vo.hook)
    .map((c) => ({ ...c, raw: rawDuration(c.vo.takes!) }))
    // Tient dans la vidéo au plus vite (×MAX_SPEED) ; idéalement la remplit à ×MIN_SPEED
    .filter((c) => c.raw / MAX_SPEED <= available + 0.3);
  if (!candidates.length) return null;
  const fill = (raw: number) => Math.abs(Math.min(1, (raw / MIN_SPEED) / available) - 1);
  candidates.sort((a, b) =>
    Number(recent.includes(a.id)) - Number(recent.includes(b.id))
    || (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0)
    || fill(a.raw) - fill(b.raw));
  const d = candidates[0];
  const voiceover: VoiceoverState = {
    status: 'voiced', hook: d.vo.hook, subject: d.vo.subject, segments: d.vo.segments, annotated: d.vo.annotated,
    model: d.vo.model, takes: d.vo.takes, verify: null, reused_from: d.id, updated_at: new Date().toISOString(),
  };
  await saveReport(id, { voiceover, audio });
  return voiceover;
}

// Étape 2 : voix phrase par phrase, contrôlée
export async function generateVoice(id: string): Promise<VoiceoverState> {
  if (!voiceoverEnabled()) throw new VoiceoverError('ElevenLabs non configuré (ELEVENLABS_API_KEY, ELEVENLABS_VOICE_ID)', 400);
  if (!(await loadRow(id)).clean_report?.voiceover?.segments?.length) await prepareVoiceoverScript(id);
  const row = await loadRow(id);
  const state: VoiceoverState = row.clean_report.voiceover;
  await lock(id, state, 'voicing');
  const tag = `${id}-${Date.now().toString(36)}`;
  try {
    const sentences: Sentence[] = state.segments.map((s) => ({ text: s.text, intention: s.intention }));
    const { model, note } = await voiceModel(sentences, tag, row.file_name ?? id);
    // Reprise : les prises déjà faites (même paragraphe, mêmes voisins) sont gardées ; l'étape
    // s'arrête avant la limite de 300 s et le passage suivant continue
    const deadline = Date.now() + 210_000;
    const seedBase = (state.autofix ?? 0) * 3;
    const validated = new Map<string, Take>((state.partial ?? []).map((k) => [`${k.prev}|${k.text}|${k.next}`, k.take]));
    const keyOf = (list: Block[], i: number) => `${list[i - 1]?.text ?? ''}|${list[i].text}|${list[i + 1]?.text ?? ''}`;
    const voiceAll = async (list: Sentence[]): Promise<Take[] | null> => {
      const blocks = buildBlocks(list);
      // 3 paragraphes en parallèle au plus (offre Starter)
      const out: Take[] = new Array(blocks.length);
      let next = 0, stopped = false;
      const worker = async () => {
        while (next < blocks.length) {
          const i = next++;
          const known = validated.get(keyOf(blocks, i));
          if (known) { out[i] = known; continue; }
          if (Date.now() > deadline) { stopped = true; return; }
          out[i] = await voiceBlock(model, blocks, i, tag, seedBase);
          validated.set(keyOf(blocks, i), out[i]);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, blocks.length) }, worker));
      if (stopped) {
        const partial = Array.from(validated.entries()).map(([k, take]) => { const [prev, text, nxt] = k.split('|'); return { prev, text, next: nxt, take }; });
        await saveState(id, { ...state, status: 'script', partial, model });
        return null;
      }
      return out;
    };
    let sentences2 = sentences;
    let takes = await voiceAll(sentences2);
    if (!takes) return { ...(await loadRow(id)).clean_report.voiceover, status: 'script' };
    // Voix trop courte même ralentie au maximum : phrases ajoutées avant la conclusion, puis
    // nouvelle voix (les paragraphes inchangés sortent du cache)
    const available = Math.max(1, (row.clean_report?.vo_base?.duration ?? 0) - 0.3);
    for (let round = 0; round < 2 && state.subject && rawDuration(takes) / MIN_SPEED < available * 0.97; round++) {
      const spoken = takes.reduce((n, k) => n + countWords(k.text), 0);
      const rate = spoken / Math.max(1, takes.reduce((t, k) => t + span(k).len, 0));
      const missing = available * MIN_SPEED * 1.02 - rawDuration(takes);
      sentences2 = await extendBody(sentences2, state.subject, Math.max(6, Math.ceil(missing * rate)));
      // Le script rallongé devient le script de référence (reprise possible au passage suivant)
      state.segments = toSegments(sentences2);
      const again = await voiceAll(sentences2);
      if (!again) return { ...(await loadRow(id)).clean_report.voiceover, status: 'script' };
      takes = again;
    }
    const segments = toSegments(sentences2);
    const done: VoiceoverState = {
      ...state, status: 'voiced', model, takes, segments, annotated: annotate(segments), verify: null, error: undefined, partial: undefined,
    };
    await saveState(id, done);
    if (note) await saveReport(id, { voice_model_note: note });
    return done;
  } catch (e: any) {
    await saveState(id, { ...state, status: 'error', error: e.message });
    throw e instanceof VoiceoverError ? e : new VoiceoverError(e.message);
  }
}

// Étape 3 : montage, puis la vidéo publiée est remplacée
export async function renderQueueVoiceover(id: string): Promise<VoiceoverState> {
  let row = await loadRow(id);
  if (!row.clean_report?.voiceover?.takes?.length) { await generateVoice(id); row = await loadRow(id); }
  const report = row.clean_report;
  const state: VoiceoverState = report.voiceover;
  await lock(id, state, 'rendering');

  const tag = `${id}-${Date.now().toString(36)}`;
  const local = tmp(`${tag}-base.mp4`);
  const voiced = tmp(`${tag}-vo.mp4`);
  let finalPath = voiced;
  try {
    await downloadBase(row, local);
    const { speed, placed, ends } = await renderVoiceover(local, state.takes!, report.audio ?? null, tag, voiced);
    const withCard = await withEndCard(voiced, `${tag}-vo`);
    finalPath = withCard.path;

    // Nouveau nom à chaque rendu : Instagram ne doit pas récupérer une version en cache
    const renderPath = `clean/${id}-vf-${Date.now()}.mp4`;
    const { error } = await supabase.storage.from(MEDIA_BUCKET)
      .upload(renderPath, await fs.readFile(finalPath), { contentType: 'video/mp4', upsert: true });
    if (error) throw new VoiceoverError(`Stockage : ${error.message}`);
    const media_url = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(renderPath).data.publicUrl;
    if (state.render_path && state.render_path !== renderPath) await supabase.storage.from(MEDIA_BUCKET).remove([state.render_path]);

    const block_times = placed.map((p, i) => ({ start: +p.toFixed(2), end: +ends[i].toFixed(2) }));
    const done: VoiceoverState = { ...state, status: 'done', block_times, render_path: renderPath, rendered_at: new Date().toISOString(), verify: null, updated_at: new Date().toISOString(), error: undefined };
    const { data: fresh } = await db().from('content_queue').select('clean_report').eq('id', id).single();
    await db().from('content_queue').update({
      storage_path: renderPath, media_url,
      ig_container_id: null,   // conteneur Instagram préparé avec l'ancienne vidéo : à refaire
      clean_report: { ...(fresh?.clean_report ?? {}), voiceover: done, end_card: withCard.appended, vo_speed: speed },
      updated_at: new Date().toISOString(),
    }).eq('id', id);
    return done;
  } catch (e: any) {
    await saveState(id, { ...state, status: 'error', error: e.message });
    throw e instanceof VoiceoverError ? e : new VoiceoverError(e.message);
  } finally {
    await Promise.all([local, voiced, finalPath].map((p) => fs.rm(p, { force: true })));
  }
}

// Mots de la fin CTA (transcrite une fois, tant que la fin CTA ne change pas)
async function ctaTokens(tag: string): Promise<string[]> {
  const { data: info } = await supabase.storage.from(MEDIA_BUCKET).list('assets', { search: 'cta-end.mp4' });
  const version = info?.find((f) => f.name === 'cta-end.mp4')?.updated_at ?? 'none';
  const cached = await storageText(CTA_TRANSCRIPT);
  if (cached) { const c = JSON.parse(cached); if (c.version === version) return c.tokens; }
  const file = tmp(`${tag}-cta.mp4`);
  if (!(await storageFile(END_CARD_PATH, file))) return [];
  const heard = await transcribe(file).catch(() => [] as SttWord[]);
  await fs.rm(file, { force: true });
  const list = heard.flatMap((w) => tokens(w.text));
  await supabase.storage.from(MEDIA_BUCKET).upload(CTA_TRANSCRIPT, JSON.stringify({ version, tokens: list, text: heard.map((w) => w.text).join(' ') }), { contentType: 'application/json', upsert: true });
  return list;
}

// Étape 4 (règle 0) : transcription du rendu ; un mot qui n'appartient ni au script ni au CTA
// → la vidéo n'est pas publiée
export async function verifyVoiceover(id: string): Promise<VoiceoverState> {
  const row = await loadRow(id);
  const state: VoiceoverState = row.clean_report?.voiceover;
  if (state?.status !== 'done' || !state.render_path) throw new VoiceoverError('Monter d\'abord la voix off', 400);
  await lock(id, state, 'verifying');
  const tag = `${id}-${Date.now().toString(36)}`;
  const video = tmp(`${tag}-final.mp4`), audio = tmp(`${tag}-final.mp3`);
  try {
    if (!(await storageFile(state.render_path, video))) throw new VoiceoverError('Rendu introuvable');
    await run(['-v', 'error', '-y', '-i', video, '-vn', '-ac', '1', '-ar', '22050', '-b:a', '64k', audio]);
    const heard = await transcribe(audio);
    const vocab = [...(state.takes ?? []).flatMap((k) => tokens(k.text)), ...(await ctaTokens(tag))];
    // Mot entendu absent du vocabulaire du script et du CTA
    const extra = heard.flatMap((w) => tokens(w.text)).filter((w) => !vocab.some((v) => same(v, w)));
    // Rigueur sur le naturel : une pause anormale AU MILIEU d'un paragraphe (coupure, souffle) →
    // ce paragraphe est refait automatiquement (2 fois au plus), sans intervention de Lomig
    const times = state.block_times ?? [];
    const badBlocks = new Set<number>();
    // Pause hors ponctuation et hors pause prévue de plus de 0,38 s (micro-coupure, souffle), ou
    // pause de plus de 0,7 s n'importe où dans un paragraphe
    const planned = plannedPauseCheck((state.takes ?? []).map((k) => k.text));
    for (let i = 0; i < heard.length - 1; i++) {
      const gap = heard[i + 1].start - heard[i].end;
      if (gap <= 0.7 && (gap <= 0.4 || planned(heard[i].text))) continue;
      const b = times.findIndex((x) => heard[i].end > x.start + 0.25 && heard[i + 1].start < x.end - 0.25);
      if (b >= 0) badBlocks.add(b);
    }
    // Hésitations (« euh »…) : pas une voix étrangère, mais un défaut de la prise → le paragraphe
    // où elles tombent est refait
    const fillerWords = heard.filter((w) => tokens(w.text).some((t) => FILLERS.has(t)));
    for (const w of fillerWords) {
      const b = times.findIndex((x) => w.start >= x.start - 0.1 && w.start <= x.end + 0.1);
      if (b >= 0) badBlocks.add(b);
    }
    const realExtra = extra.filter((w) => !FILLERS.has(w));
    // Une seule reprise automatique (économie de crédits)
    if (!realExtra.length && badBlocks.size && (state.autofix ?? 0) < 2 && state.takes) {
      const blocksText = state.takes.map((k) => k.text);
      const partial = state.takes
        .map((take, i) => ({ prev: blocksText[i - 1] ?? '', text: take.text, next: blocksText[i + 1] ?? '', take, i }))
        .filter((x) => !badBlocks.has(x.i)).map(({ i, ...rest }) => rest);
      const retry: VoiceoverState = { ...state, status: 'script', partial, takes: undefined, verify: null, autofix: (state.autofix ?? 0) + 1,
        error: `Pause anormale dans ${badBlocks.size} paragraphe(s) : refait automatiquement` };
      await saveState(id, retry);
      return retry;
    }
    const verify = { ok: !extra.length, extra: Array.from(new Set(extra)).slice(0, 30), transcript: heard.map((w) => w.text).join(' ').slice(0, 2000), at: new Date().toISOString() };
    // VF en plus refusée au contrôle : le reel repart dans sa version d'origine plutôt que d'être bloqué
    if (!verify.ok && isExtra(row.clean_report)) {
      const original = `clean/${id}.mp4`;
      const media_url = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(original).data.publicUrl;
      const { data: fresh } = await db().from('content_queue').select('clean_report').eq('id', id).single();
      await db().from('content_queue').update({
        storage_path: original, media_url, ig_container_id: null,
        clean_report: { ...(fresh?.clean_report ?? {}), voiceover: { ...state, status: 'skipped', verify, updated_at: new Date().toISOString() } },
      }).eq('id', id);
      return { ...state, status: 'skipped', verify };
    }
    const done: VoiceoverState = { ...state, status: 'done', verify, error: undefined };
    await saveState(id, done);
    return done;
  } catch (e: any) {
    await saveState(id, { ...state, status: 'done', error: `Contrôle du rendu : ${e.message}` });
    throw e instanceof VoiceoverError ? e : new VoiceoverError(e.message);
  } finally {
    await Promise.all([video, audio].map((p) => fs.rm(p, { force: true })));
  }
}

// Étape suivante d'un reel (cron et bouton « Tout enchaîner »)
export async function runNextVoiceoverStep(id: string): Promise<{ step: string; state: VoiceoverState }> {
  const report = (await loadRow(id)).clean_report;
  const vo: VoiceoverState | undefined = report?.voiceover;
  // Pas de script, ou ancien commentaire d'avant le cahier des charges du 09/10 (sans hook) :
  // d'abord une voix déjà générée ; sinon nouvelle voix seulement si la vidéo l'exige (voix d'origine
  // à remplacer), pour ne pas dépenser de crédits sur les reels où la VF est un bonus
  if (!vo?.segments?.length || !vo.hook) {
    const reused = await reuseVoiceover(id);
    if (reused) return { step: 'reuse', state: reused };
    if (report?.audio?.voice !== true) {
      const skipped: VoiceoverState = { status: 'skipped', segments: [], error: 'Aucune voix déjà générée ne tient dans cette vidéo : publiée sans voix off', updated_at: new Date().toISOString() };
      await saveReport(id, { voiceover: skipped });
      return { step: 'skip', state: skipped };
    }
    return { step: 'script', state: await prepareVoiceoverScript(id, true) };
  }
  // Voix reprise : déjà contrôlée sur son reel d'origine, et le son d'origine est retiré dès qu'il
  // contient une voix ou des paroles → pas de nouvelle transcription (crédits économisés)
  if (vo.status === 'done' && !vo.verify && (vo.reused_from || vo.rerender)) {
    const ok: VoiceoverState = { ...vo, verify: { ok: true, extra: [], transcript: '(voix reprise, déjà vérifiée)', at: new Date().toISOString() } };
    await saveReport(id, { voiceover: ok });
    return { step: 'verify', state: ok };
  }
  if (vo.status === 'script' || (vo.status === 'voicing')) return { step: 'voice', state: await generateVoice(id) };
  if (vo.status === 'voiced' || vo.status === 'rendering') return { step: 'render', state: await renderQueueVoiceover(id) };
  if (vo.status === 'done' && !vo.verify) return { step: 'verify', state: await verifyVoiceover(id) };
  if (vo.status === 'verifying') return { step: 'verify', state: await verifyVoiceover(id) };
  return { step: 'none', state: vo };
}

// La voix off de Lomig ne concerne QUE les vidéos où quelqu'un d'autre parle (décision de
// Lomig du 09/10/2026) ; les autres (musique, bruits de chantier) sont publiées telles quelles.
// + « VF en plus » (demande de Lomig du 11/10/2026) : 2 reels sans voix d'origine par jour, choisis
// parmi ceux qui ont une musique (gardée sous la voix), tant que le budget ElevenLabs le permet.
// 13/10/2026 : voix off de Lomig sur TOUS les reels (VOICEOVER_ALL=false pour revenir en arrière),
// en réutilisant d'abord les voix déjà générées. Pour un reel sans voix d'origine, la VF reste non
// bloquante : si elle n'est pas prête à l'heure, la version d'origine part.
const VOICE_ALL = process.env.VOICEOVER_ALL !== 'false';
export const needsVoiceover = (report: any) => report?.audio?.voice === true || report?.vo_extra === true || (VOICE_ALL && !!report);
const isExtra = (report: any) => report?.audio?.voice !== true && (report?.vo_extra === true || VOICE_ALL);
const EXTRA_PER_DAY = Number(process.env.VOICEOVER_EXTRA_PER_DAY ?? 2);
const CREDIT_FLOOR  = Number(process.env.VOICEOVER_CREDIT_FLOOR ?? 5000);   // réserve pour les vidéos avec voix d'origine

async function creditsLeft(): Promise<number | null> {
  const res = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! }, cache: 'no-store' });
  if (!res.ok) return null;
  const d = await res.json();
  return (d.character_limit ?? 0) - (d.character_count ?? 0);
}

// Choisit, pour chaque jour à venir, jusqu'à EXTRA_PER_DAY reels programmés sans voix d'origine
// (musique d'abord, puis bruits de chantier ; le son d'origine reste sous la voix), qui recevront
// la voix off de Lomig. Rien de nouveau si le solde de crédits passe sous CREDIT_FLOOR.
export async function selectExtraVoiceovers(): Promise<number> {
  if (EXTRA_PER_DAY <= 0) return 0;
  const left = await creditsLeft();
  if (left == null || left < CREDIT_FLOOR) return 0;
  const from = new Date(Date.now() + 90 * 60_000).toISOString();   // le temps de monter la VF
  const { data } = await db().from('content_queue')
    .select('id, scheduled_at, clean_report').eq('format', 'reel').eq('status', 'scheduled')
    .gte('scheduled_at', from).order('scheduled_at', { ascending: true }).limit(200);
  const day = (iso: string) => new Date(iso).toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  const perDay = new Map<string, number>();
  for (const r of data ?? []) if (r.clean_report?.vo_extra) perDay.set(day(r.scheduled_at), (perDay.get(day(r.scheduled_at)) ?? 0) + 1);
  let marked = 0;
  // Musique d'abord, puis bruits de chantier (ordre chronologique conservé dans chaque groupe)
  const ordered = [...(data ?? [])].sort((x: any, y: any) =>
    Number(y.clean_report?.audio?.kind === 'musique_seule') - Number(x.clean_report?.audio?.kind === 'musique_seule'));
  for (const r of ordered) {
    const rep = r.clean_report ?? {};
    if (rep.vo_extra || rep.audio?.voice !== false || !['musique_seule', 'sons_ambiants'].includes(rep.audio?.kind) || rep.voiceover) continue;
    const d = day(r.scheduled_at);
    if ((perDay.get(d) ?? 0) >= EXTRA_PER_DAY) continue;
    await saveReport(r.id, { vo_extra: true });
    perDay.set(d, (perDay.get(d) ?? 0) + 1);
    marked++;
  }
  return marked;
}

// Un reel peut-il être programmé / publié ?
export function voiceoverBlocks(report: any): string | null {
  const vo: VoiceoverState | undefined = report?.voiceover;
  if (vo?.status === 'skipped') return null;
  // VF en plus : jamais bloquante (si elle n'est pas prête ou pas valide, la version d'origine part)
  if (isExtra(report)) return null;
  if (vo?.verify && !vo.verify.ok) return `Voix étrangère détectée dans le rendu (${vo.verify.extra.slice(0, 5).join(', ')}) : pas de publication`;
  if (!needsVoiceover(report)) return null;
  if (vo?.status === 'done' && vo.verify?.ok) return null;
  return `Voix d'origine (${report.audio.language ?? '?'}) : voix off de Lomig pas encore montée et vérifiée`;
}

// Rattrapage : un reel qui a une étape à faire (brouillon, ou programmé dans plus de 45 min)
export async function nextVoiceoverCandidate(): Promise<string | null> {
  const soon = new Date(Date.now() + 45 * 60_000).toISOString();
  const { data } = await db().from('content_queue')
    .select('id, status, scheduled_at, clean_report')
    .eq('format', 'reel').in('status', ['draft', 'scheduled'])
    .order('scheduled_at', { ascending: true, nullsFirst: false }).limit(50);
  const stale = Date.now() - 10 * 60_000;
  const c = (data ?? []).find((r: any) => {
    // Vidéos où quelqu'un d'autre parle, et « VF en plus »
    if (!needsVoiceover(r.clean_report)) return false;
    // VF en plus : pas si le reel part dans moins d'une heure (il partira dans sa version d'origine)
    if (isExtra(r.clean_report) && r.scheduled_at && new Date(r.scheduled_at).getTime() < Date.now() + 60 * 60_000) return false;
    // Programmé bientôt : traité quand même en mode automatique (sa publication attend la voix
    // off) ; en mode manuel, on ne touche pas à un reel qui part dans moins de 45 min
    if (!voiceoverAuto() && r.status === 'scheduled' && r.scheduled_at && r.scheduled_at < soon) return false;
    const vo: VoiceoverState | undefined = r.clean_report?.voiceover;
    if (!vo?.segments?.length) return true;
    if (BUSY.includes(vo.status)) return new Date(vo.updated_at).getTime() < stale;   // traitement interrompu
    if (vo.status === 'error') return false;   // erreur : à relancer depuis le CRM
    // Ancien commentaire (avant le cahier des charges du 09/10) : on repart d'un script neuf
    if (!vo.hook) return true;
    return vo.status === 'script' || vo.status === 'voiced' || (vo.status === 'done' && !vo.verify);
  });
  return c?.id ?? null;
}

export { SUBJECTS, HOOKS, countWords };
