import { promises as fs } from 'fs';
import path from 'path';
import type { Intention } from '@/lib/voiceScript';

// Contrôle de la voix générée (cahier des charges de Lomig, § 7.4 et règle 0) : transcription
// mot à mot (ElevenLabs Speech to Text) comparée au script.

export interface SttWord { text: string; start: number; end: number; logprob?: number }

export async function transcribe(file: string): Promise<SttWord[]> {
  const form = new FormData();
  form.append('model_id', 'scribe_v1');
  form.append('language_code', 'fra');
  form.append('timestamps_granularity', 'word');
  form.append('tag_audio_events', 'false');
  form.append('file', new Blob([await fs.readFile(file)]), path.basename(file));
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY! }, body: form, cache: 'no-store',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Transcription ElevenLabs : ${body.detail?.message ?? res.status}`);
  return (body.words ?? []).filter((w: any) => w.type === 'word').map((w: any) => ({ text: w.text, start: w.start, end: w.end, logprob: w.logprob }));
}

// ─── Normalisation ───────────────────────────────────────────────────────────

const UNITS = ['zéro', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf', 'dix', 'onze', 'douze', 'treize',
  'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
const TENS = ['', '', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante'];

function numberToFr(n: number): string {
  if (n < 20) return UNITS[n];
  if (n < 70) return TENS[Math.floor(n / 10)] + (n % 10 === 1 ? ' et un' : n % 10 ? `-${UNITS[n % 10]}` : '');
  if (n < 80) return 'soixante' + (n === 71 ? ' et onze' : `-${UNITS[n - 60]}`);
  if (n < 100) return 'quatre-vingt' + (n === 80 ? 's' : `-${UNITS[n - 80]}`);
  if (n < 1000) return (n < 200 ? 'cent' : `${UNITS[Math.floor(n / 100)]} cent`) + (n % 100 ? ` ${numberToFr(n % 100)}` : '');
  if (n < 1_000_000) return (n < 2000 ? 'mille' : `${numberToFr(Math.floor(n / 1000))} mille`) + (n % 1000 ? ` ${numberToFr(n % 1000)}` : '');
  return String(n);
}

const strip = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Texte → liste de mots comparables (sans accents, ponctuation ni balises ; chiffres en lettres)
export function tokens(text: string): string[] {
  return strip(text
    .replace(/<[^>]+>/g, ' ')
    .replace(/\[[^\]]+\]/g, ' ')
    .replace(/(\d+)\s*%/g, '$1 pour cent')
    .replace(/\d+/g, (d) => numberToFr(Number(d))))
    .replace(/['’]/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1)    // mots d'une lettre (l', d', y…) ignorés
    .map((w) => ALIASES[w] ?? w);
}

// Graphies de prononciation (voir PRONUNCIATIONS dans voiceover.ts) ramenées au mot du script
const ALIASES: Record<string, string> = { prospe: 'prospect', prospes: 'prospects' };

function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) {
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return d[a.length][b.length];
}
// Le français écrit a des terminaisons muettes (« ils galèrent » = « il galère » à l'oral) : on
// compare les mots sans elles, puis avec une faute de frappe tolérée sur les mots longs
const stem = (w: string) => {
  if (w.length <= 3) return w.replace(/s$/, '');
  for (let i = 0; i < 2 && w.length > 3; i++) w = w.replace(/(ent|ez|er|es|e|s|x|t|d)$/, '');
  return w;
};
export const same = (a: string, b: string) => {
  if (a === b) return true;
  const sa = stem(a), sb = stem(b);
  return sa === sb || (Math.min(sa.length, sb.length) >= 4 && lev(sa, sb) <= 1);
};

// Mots du script absents de la transcription, et mots transcrits absents du script (ordre respecté)
export function diffWords(expected: string[], heard: string[]): { missing: string[]; extra: string[] } {
  const n = expected.length, m = heard.length;
  const L = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) {
    L[i][j] = same(expected[i], heard[j]) ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  }
  const missing: string[] = [], extra: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (same(expected[i], heard[j])) { i++; j++; }
    else if (L[i + 1][j] >= L[i][j + 1]) missing.push(expected[i++]);
    else extra.push(heard[j++]);
  }
  while (i < n) missing.push(expected[i++]);
  while (j < m) extra.push(heard[j++]);
  return { missing, extra };
}

// ─── Contrôle d'une phrase (§ 7.4) ───────────────────────────────────────────

export interface SentenceQC { ok: boolean; issues: string[]; rate: number }

// Débits (mots/s, avant accélération) : le français parlé tourne autour de 3 à 4 mots/s ; on ne
// rejette que les excès nets (CHOC et INSISTANCE précipités, ÉNERGIQUE traînant)
const RATE_LIMITS: Partial<Record<Intention, { min?: number; max?: number }>> = {
  CHOC: { max: 4.3 }, INSISTANCE: { max: 4.3 }, ENERGIQUE: { min: 2.2 },
};

// Hésitations ajoutées par la voix clonée : toujours un défaut
export const FILLERS = new Set(['euh', 'heu', 'hum', 'hmm', 'bah', 'ben', 'hein', 'eh']);

export function checkSentence(text: string, intention: Intention, heard: SttWord[]): SentenceQC {
  const issues: string[] = [];
  const fillers = heard.filter((w) => tokens(w.text).some((t) => FILLERS.has(t))).map((w) => w.text);
  if (fillers.length) issues.push(`pause d'hésitation (${fillers.join(', ')})`);
  const { missing, extra } = diffWords(tokens(text), heard.flatMap((w) => tokens(w.text)));
  if (missing.length) issues.push(`mots avalés : ${missing.join(', ')}`);
  if (extra.length) issues.push(`mots en trop ou déformés : ${extra.join(', ')}`);

  // Pauses : permises après une ponctuation (ou « … ») du script, jamais au-delà de 0,6 s ;
  // ailleurs, une pause de plus de 0,25 s coupe un groupe de sens
  const plannedAfter = plannedPauseCheck([text]);
  let pauseTime = 0;
  for (let i = 0; i < heard.length - 1; i++) {
    const gap = heard[i + 1].start - heard[i].end;
    if (gap > 0.6) issues.push(`pause de ${gap.toFixed(2)} s après « ${heard[i].text} »`);
    // Arrêt net au milieu d'une phrase (signe d'IA, 11/10/2026) : prise à refaire
    else if (gap > 0.4 && !plannedAfter(heard[i].text)) issues.push(`coupure de ${gap.toFixed(2)} s au milieu d'une phrase après « ${heard[i].text} »`);
    else if (gap > 0.25 && !plannedAfter(heard[i].text)) issues.push(`pause au milieu d'un groupe de sens après « ${heard[i].text} »`);
    if (gap > 0.1) pauseTime += gap;
  }

  // Mot mal prononcé : la transcription l'entend avec une confiance faible (mot de 4 lettres et plus)
  const unclear = heard.filter((w) => (w.logprob ?? 0) < -1.2 && tokens(w.text).some((t) => t.length >= 4)).map((w) => w.text);
  if (unclear.length) issues.push(`mot mal prononcé : ${unclear.join(', ')}`);

  const spoken = heard.length ? heard[heard.length - 1].end - heard[0].start - pauseTime : 0;
  const rate = spoken > 0 ? heard.length / spoken : 0;
  const lim = RATE_LIMITS[intention];
  if (lim?.max && rate > lim.max) issues.push(`débit trop rapide pour ${intention} (${rate.toFixed(1)} mots/s)`);
  if (lim?.min && rate && rate < lim.min) issues.push(`débit trop lent pour ${intention} (${rate.toFixed(1)} mots/s)`);
  return { ok: !issues.length, issues, rate: +rate.toFixed(2) };
}

// Pauses prévues par le script : après une ponctuation ou un « … » (et après les pivots).
// Renvoie un test : « une pause après ce mot entendu est-elle prévue ? »
export function plannedPauseCheck(texts: string[]): (heardWord: string) => boolean {
  const pauseWords = new Set<string>();
  for (const text of texts) {
    for (const m of Array.from(text.replace(/<[^>]+>/g, '…').matchAll(/([A-Za-zÀ-ÿ0-9'’-]+)\s*(?=[,;:.!?…])/g))) {
      const t = tokens(m[1]); if (t.length) pauseWords.add(t[t.length - 1]);
    }
  }
  return (w: string) => /[,;:.!?…]$/.test(w) || pauseWords.has(tokens(w).at(-1) ?? '');
}
