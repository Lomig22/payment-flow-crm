// Assemble un reel de la fabrique : durées des scènes (voix off ou temps de lecture), timing.js,
// data.js, son (voix + bruitages + musique, -14 LUFS) et durée de la composition.
// Usage : node build.mjs <dossier>   (le dossier contient index.html, data.json, vo/<i>.mp3 facultatifs)
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const dir = process.argv[2];
if (!dir) { console.error("Usage : node build.mjs <dossier>"); process.exit(1); }
const SFX = join(dirname(fileURLToPath(import.meta.url)), "shared", "sfx");
const data = JSON.parse(readFileSync(join(dir, "data.json"), "utf8"));
const S = data.scenes;
const LEAD = 0.08, TAIL = 0.12;   // la voix démarre aussitôt, la coupe suit sa fin de près

const run = (args) => execFileSync("ffmpeg", ["-v", "error", "-y", ...args], { stdio: ["ignore", "ignore", "inherit"] });
const dur = (p) => Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).toString().trim());
const SKIP = new Set(["type", "mode", "icon", "keyword", "prefix", "suffix", "value", "total", "vo", "music"]);
const texts = (v, k) => (SKIP.has(k) ? [] : typeof v === "string" ? [v] : Array.isArray(v) ? v.flatMap((x) => texts(x)) : v && typeof v === "object" ? Object.entries(v).flatMap(([kk, x]) => texts(x, kk)) : []);
const words = (s) => texts(s).join(" ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

// Durées minimales et bruitages : beats.js (partagé avec le gabarit)
createRequire(import.meta.url)("./shared/beats.js");
const B = globalThis.PF_BEATS;
const read = (s) => clamp(0.5 + words(s) * 0.2, 0, 4);   // sans voix : lecture rapide (Reels)

// 1. Voix : silences du début et de la fin retirés
const vo = S.map((_, i) => {
  // Voix : MP3 (ElevenLabs / Google) ou WAV (Piper, synthétisée sur le VPS)
  const src = [join(dir, "vo", `${i}.mp3`), join(dir, "vo", `${i}.wav`)].find((f) => existsSync(f));
  if (!src) return null;
  const out = join(dir, "vo", `.${i}.wav`);
  run(["-i", src, "-af", "silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse", "-ar", "44100", "-ac", "2", out]);
  return { path: out, d: dur(out) };
});

// 2. Scènes : le temps de leur phrase, sinon le temps de lecture, jamais moins que leurs animations
const T = [0];
const D = S.map((s, i) => {
  const last = i === S.length - 1;
  const need = vo[i] ? LEAD + vo[i].d + (last ? 1.0 : TAIL) : read(s) + (last ? 0.6 : 0);
  return Math.round(Math.max(B.min[s.type](s), need) * 100) / 100;
});
for (let i = 0; i < S.length - 1; i++) T.push(Math.round((T[i] + D[i]) * 100) / 100);
const END = Math.round((T[S.length - 1] + D[S.length - 1]) * 100) / 100;
writeFileSync(join(dir, "timing.js"), `// Généré par build.mjs\nwindow.__PF_T = ${JSON.stringify({ T, END })};\n`);
writeFileSync(join(dir, "data.js"), `// Généré par build.mjs\nwindow.__PF_DATA = ${JSON.stringify(data)};\n`);

// 3. Son
const cues = [];
S.forEach((s, i) => {
  if (i > 0) cues.push(["whoosh", T[i] - 0.06, 0.38]);
  for (const [name, at, vol] of B.cues(s, D[i])) cues.push([name, T[i] + at, vol]);
});
const inputs = [], parts = [], vlabels = [], flabels = [];
vo.forEach((v, i) => {
  if (!v) return;
  const k = inputs.length / 2, ms = Math.round((T[i] + LEAD) * 1000);
  inputs.push("-i", v.path);
  parts.push(`[${k}]adelay=${ms}|${ms}[v${i}]`);
  vlabels.push(`[v${i}]`);
});
cues.forEach(([name, at, vol], j) => {
  const k = inputs.length / 2, ms = Math.round(Math.max(0, at) * 1000);
  inputs.push("-i", join(SFX, `${name}.mp3`));
  parts.push(`[${k}]volume=${vol},adelay=${ms}|${ms}[f${j}]`);
  flabels.push(`[f${j}]`);
});
const m = inputs.length / 2;
inputs.push("-stream_loop", "-1", "-i", join(SFX, data.music || "music.mp3"));
parts.push(`${flabels.join("")}amix=inputs=${flabels.length}:normalize=0,apad=whole_dur=${END}[fx]`);
if (vlabels.length) {
  parts.push(
    `${vlabels.join("")}amix=inputs=${vlabels.length}:normalize=0,apad=whole_dur=${END}[vo]`,
    "[vo]asplit=2[vomix][key]",
    `[${m}]atrim=0:${END},volume=0.22,afade=t=out:st=${END - 1.2}:d=1.2[mus]`,
    "[mus][key]sidechaincompress=threshold=0.02:ratio=8:attack=15:release=350[musd]",
    `[vomix][musd][fx]amix=inputs=3:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,atrim=0:${END}[out]`,
  );
} else {
  // Sans voix : la musique porte le reel
  parts.push(
    `[${m}]atrim=0:${END},volume=0.5,afade=t=in:d=0.3,afade=t=out:st=${END - 1.2}:d=1.2[mus]`,
    `[mus][fx]amix=inputs=2:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9,atrim=0:${END}[out]`,
  );
}
run([...inputs, "-filter_complex", parts.join(";"), "-map", "[out]", "-ar", "44100", "-ac", "2", join(dir, "audio.wav")]);

// 4. Durée de la composition
const idx = join(dir, "index.html");
writeFileSync(idx, readFileSync(idx, "utf8").replace(/(id="(?:root|audio)"[^>]*data-duration=")[0-9.]+(")/g, `$1${END}$2`));
console.log(JSON.stringify({ T, END, voiced: vo.filter(Boolean).length }));
