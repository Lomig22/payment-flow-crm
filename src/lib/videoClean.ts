import { spawn } from 'child_process';
import { promises as fsp } from 'fs';
import ffmpegPath from 'ffmpeg-static';

// Nettoyage des vidéos avant publication : retire toutes les métadonnées (GPS,
// appareil, dates, logiciel, auteur, pistes de données) SANS réencoder. Les
// flux vidéo et audio sont recopiés à l'identique ; la preuve est une empreinte
// SHA-256 par flux, calculée avant et après, qui doit être la même.
// L'orientation (matrice d'affichage du flux vidéo) est conservée.

export function run(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg introuvable'));
    const p = spawn(ffmpegPath, args);
    let stdout = '', stderr = '';
    p.stdout.on('data', (d) => { stdout += d; });
    p.stderr.on('data', (d) => { stderr += d; });
    p.on('error', reject);
    p.on('close', (code) =>
      code === 0 ? resolve({ stdout, stderr }) : reject(new Error(stderr.trim().split('\n').pop() || `ffmpeg code ${code}`)));
  });
}

// Empreintes par flux vidéo/audio (hors vignettes), ex. ["0,v,SHA256=…", "1,a,SHA256=…"]
async function streamHashes(file: string): Promise<string[]> {
  const { stdout } = await run(['-v', 'error', '-i', file, '-map', '0:V', '-map', '0:a?',
    '-c', 'copy', '-f', 'streamhash', '-hash', 'sha256', '-']);
  return stdout.trim().split('\n').filter(Boolean);
}

// Métadonnées globales du fichier (clé=valeur), pour le rapport
async function globalTags(file: string): Promise<Record<string, string>> {
  const { stdout } = await run(['-v', 'error', '-i', file, '-f', 'ffmetadata', '-']);
  const tags: Record<string, string> = {};
  for (const line of stdout.split('\n')) {
    const m = line.match(/^([^;=][^=]*)=(.*)$/);
    if (m) tags[m[1]] = m[2];
  }
  return tags;
}

// Pistes autres que vidéo/audio (données, sous-titres, timecode…) : retirées aussi
async function extraStreams(file: string): Promise<string[]> {
  const { stderr } = await run(['-hide_banner', '-i', file, '-f', 'null', '-t', '0', '-']).catch((e) => ({ stderr: String(e.message), stdout: '' }));
  return stderr.split('\n')
    .filter((l) => /Stream #0:\d+.*: (Data|Subtitle|Attachment):/.test(l))
    .map((l) => l.trim());
}

// Images JPEG réparties sur la durée de la vidéo (pour la rédaction de la légende)
export async function extractFrames(file: string, outPrefix: string, count = 6): Promise<string[]> {
  const { stderr } = await run(['-hide_banner', '-i', file, '-f', 'null', '-t', '0', '-']).catch((e) => ({ stderr: String(e.message), stdout: '' }));
  const m = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  const duration = m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 10;
  const paths: string[] = [];
  for (let i = 0; i < count; i++) {
    const t   = (duration * (i + 0.5)) / count;
    const out = `${outPrefix}-${i}.jpg`;
    await run(['-v', 'error', '-y', '-ss', t.toFixed(2), '-i', file, '-frames:v', '1',
      '-vf', 'scale=768:-2', '-q:v', '4', out]);
    paths.push(out);
  }
  return paths;
}

// Empreinte visuelle (dHash 64 bits, en hex) d'une image : robuste au réencodage
// et au redimensionnement, sert à reconnaître une vidéo déjà publiée.
export async function imageDHash(file: string): Promise<string> {
  const raw = await new Promise<Buffer>((resolve, reject) => {
    if (!ffmpegPath) return reject(new Error('ffmpeg introuvable'));
    const p = spawn(ffmpegPath, ['-v', 'error', '-i', file, '-vf', 'scale=9:8,format=gray', '-f', 'rawvideo', '-']);
    const chunks: Buffer[] = [];
    p.stdout.on('data', (d) => chunks.push(d));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve(Buffer.concat(chunks)) : reject(new Error(`ffmpeg code ${code}`))));
  });
  if (raw.length < 72) throw new Error('Image illisible');
  let hex = '';
  for (let row = 0; row < 8; row++) {
    let byte = 0;
    for (let col = 0; col < 8; col++) byte = (byte << 1) | (raw[row * 9 + col] > raw[row * 9 + col + 1] ? 1 : 0);
    hex += byte.toString(16).padStart(2, '0');
  }
  return hex;
}

export function hashDistance(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < a.length; i += 2) {
    let x = parseInt(a.slice(i, i + 2), 16) ^ parseInt(b.slice(i, i + 2), 16);
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

// Caractéristiques utiles d'une vidéo (lues dans la sortie d'ffmpeg)
export async function probe(file: string): Promise<{ width: number; height: number; fps: number; audio: boolean; duration: number; display_width: number; display_height: number }> {
  const { stderr } = await run(['-hide_banner', '-i', file, '-f', 'null', '-t', '0', '-']).catch((e) => ({ stderr: String(e.message), stdout: '' }));
  const v   = stderr.match(/Stream #0:\d+.*Video:.*?(\d{2,5})x(\d{2,5})/);
  const fps = stderr.match(/(\d+(?:\.\d+)?) fps/);
  const d   = stderr.match(/Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/);
  if (!v) throw new Error('Vidéo illisible');
  // Rotation (vidéos de téléphone stockées « couchées ») : dimensions telles qu'affichées
  const rot = Math.abs(Number(stderr.match(/rotation of (-?\d+(?:\.\d+)?) degrees/)?.[1] ?? 0)) % 180;
  return {
    width: +v[1], height: +v[2],
    display_width: rot === 90 ? +v[2] : +v[1], display_height: rot === 90 ? +v[1] : +v[2],
    fps: fps ? Math.min(60, Math.round(+fps[1])) : 30,
    audio: /Stream #0:\d+.*Audio:/.test(stderr),
    duration: d ? +d[1] * 3600 + +d[2] * 60 + +d[3] : 0,
  };
}

// Reel horizontal (vidéo TikTok ou caméra en paysage) → vertical 1080 × 1920 : la vidéo entière au
// centre, sur un fond flouté et assombri tiré d'elle-même (rien n'est coupé ni étiré)
export async function reframeVertical(input: string, output: string): Promise<void> {
  await run([
    '-y', '-i', input,
    '-filter_complex',
    '[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=28:3,eq=brightness=-0.12[bg];' +
    '[0:v]scale=1080:-2[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,setsar=1,format=yuv420p[v]',
    '-map', '[v]', '-map', '0:a?', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '19', '-c:a', 'copy', '-movflags', '+faststart', output,
  ]);
}

// Prolongation de la séquence de fin : sa dernière image reste affichée en plus (temps de
// lecture du texte du CTA), avec du silence
export const END_CARD_HOLD_S = 1;

// Ajoute la séquence de fin (CTA) après la vidéo : la séquence est mise au format de la
// vidéo (taille, cadence), un silence est ajouté là où il manque du son. Réencodage en
// haute qualité (CRF 18) : visuellement identique, mais plus une copie au bit près.
export async function appendEndCard(main: string, card: string, output: string): Promise<void> {
  const [m, c] = await Promise.all([probe(main), probe(card)]);
  const W = m.width % 2 ? m.width - 1 : m.width, H = m.height % 2 ? m.height - 1 : m.height;
  // Temps de traitement (limite de 5 min d'une fonction Vercel, 1 processeur) : au-delà de 2 000
  // images à réencoder (ex. 63 s à 60 i/s en HEVC = 6 min), cadence ramenée à 30 i/s, celle
  // des reels Instagram ; preset superfast (2,5× plus rapide que veryfast, mesuré le 13/10/2026)
  const fps = m.duration * m.fps > 2000 ? Math.min(m.fps, 30) : m.fps;
  const args = ['-v', 'error', '-y', '-i', main, '-i', card];
  // Pistes de silence pour les vidéos sans son (entrées 2 et 3 au besoin)
  let next = 2;
  const mainAudio = m.audio ? '[0:a]' : `[${next++}:a]`;
  if (!m.audio) args.push('-f', 'lavfi', '-t', String(m.duration || 1), '-i', 'anullsrc=r=44100:cl=stereo');
  const cardAudio = c.audio ? '[1:a]' : `[${next++}:a]`;
  if (!c.audio) args.push('-f', 'lavfi', '-t', String(c.duration || 1), '-i', 'anullsrc=r=44100:cl=stereo');

  const fmt = 'aformat=sample_rates=44100:channel_layouts=stereo';
  const filter = [
    `[0:v]scale=${W}:${H},setsar=1,fps=${fps},format=yuv420p[v0]`,
    `[1:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps},format=yuv420p,tpad=stop_mode=clone:stop_duration=${END_CARD_HOLD_S}[v1]`,
    `${mainAudio}${fmt}[a0]`,
    `${cardAudio}${fmt},apad=pad_dur=${END_CARD_HOLD_S}[a1]`,
    '[v0][a0][v1][a1]concat=n=2:v=1:a=1[v][a]',
  ].join(';');
  // Débit plafonné : jamais au-delà du budget (~44 Mio, limite de 50 Mo par fichier du
  // stockage), ni au-delà de 1,5× le débit d'origine (réencoder plus haut n'apporte rien
  // et alourdit le fichier). Pas de plancher au-dessus du budget : une vidéo longue doit tenir.
  const total   = m.duration + c.duration + END_CARD_HOLD_S;
  const budget  = Math.floor((44 * 8192) / Math.max(1, total)) - 192;
  const srcKbps = m.duration ? ((await fsp.stat(main)).size * 8 / 1024) / m.duration : 10_000;
  const kbps    = Math.max(300, Math.min(10_000, budget, Math.round(Math.max(srcKbps * 1.5, 2500))));
  await run([...args, '-filter_complex', filter, '-map', '[v]', '-map', '[a]',
    '-c:v', 'libx264', '-preset', 'superfast', '-crf', '18', '-maxrate', `${kbps}k`, '-bufsize', `${kbps * 2}k`,
    '-c:a', 'aac', '-b:a', '192k',
    '-map_metadata', '-1', '-movflags', '+faststart', output]);
  const outMb = (await fsp.stat(output)).size / 1_048_576;
  if (outMb > 47) {
    throw new Error(`Vidéo trop lourde après ajout de la fin CTA (${outMb.toFixed(1)} Mo, ${Math.round(total)} s) : raccourcis-la ou compresse-la avant de la déposer`);
  }
}

// Clés structurelles du conteneur MP4, réécrites par ffmpeg, qui ne sont pas des métadonnées personnelles
const STRUCTURAL = new Set(['major_brand', 'minor_version', 'compatible_brands']);

export interface CleanReport {
  removed_tags:    Record<string, string>;  // métadonnées retirées
  removed_streams: string[];                // pistes de données retirées
  hashes_before:   string[];
  hashes_after:    string[];
  lossless:        boolean;                 // flux vidéo/audio identiques au bit près
}

export async function cleanVideo(input: string, output: string): Promise<CleanReport> {
  const [before, tags, streams] = await Promise.all([streamHashes(input), globalTags(input), extraStreams(input)]);

  await run(['-v', 'error', '-y', '-i', input,
    '-map', '0:V', '-map', '0:a?',
    '-map_metadata', '-1', '-map_chapters', '-1',
    '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
    '-c', 'copy', '-movflags', '+faststart',
    output]);

  const after = await streamHashes(output);
  const removed_tags = Object.fromEntries(Object.entries(tags).filter(([k]) => !STRUCTURAL.has(k)));

  return {
    removed_tags,
    removed_streams: streams,
    hashes_before:   before,
    hashes_after:    after,
    lossless:        before.length > 0 && before.length === after.length && before.every((h, i) => h === after[i]),
  };
}
