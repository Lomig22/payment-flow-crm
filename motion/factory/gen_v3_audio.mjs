// Musique et bruitages du modèle v3 (brief du 19/10/2026), générés une fois avec ElevenLabs.
// Usage : node --env-file=../../.env.local gen_v3_audio.mjs [nom…]
import fs from 'node:fs';
const KEY = process.env.ELEVENLABS_API_KEY;
const OUT = new URL('./shared/v3/', import.meta.url);
const MUSIC = {
  'music-night': { ms: 22000, prompt: 'Cinematic film score, acoustic instruments only, no synths, no drums, no electronic sounds. Opens with an intimate, soft solo felt piano in a minor key at night, then a short repeating piano motif loops with a low cello and pizzicato double bass, slowly building tension with sustained strings, ending on an unresolved suspended chord. 80 bpm. Melancholic, hopeful undertone.' },
  'music-dawn': { ms: 14000, prompt: 'Cinematic film score, acoustic instruments only, no synths, no drums. A luminous burst in a bright major key like a sunrise: sweeping full string orchestra with harp glissando and warm piano chords, uplifting and emotional, resolving into one big warm sustained major chord that fades out. 80 bpm.' },
};
const SFX = {
  'tictac': 'Quiet old wall clock ticking in a silent room at night, realistic, close',
  'vibration': 'A smartphone vibrating twice on a wooden desk, realistic, short',
  'notification': 'Soft, warm, pleasant smartphone notification chime, single gentle ding, not harsh, realistic',
  'stylo': 'Felt marker writing quickly on a paper wall planner, realistic, short',
  'moteur': 'A small utility van engine starting and idling outside, heard through a window, realistic',
  'oiseaux': 'Birds chirping softly at dawn outside a window, peaceful, realistic',
};
const only = process.argv.slice(2);
for (const [name, m] of Object.entries(MUSIC)) {
  if (only.length && !only.includes(name)) continue;
  const r = await fetch('https://api.elevenlabs.io/v1/music?output_format=mp3_44100_128', { method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt: m.prompt, music_length_ms: m.ms }) });
  if (!r.ok) { console.error(name, r.status, (await r.text()).slice(0, 300)); continue; }
  fs.writeFileSync(new URL(`${name}.mp3`, OUT), Buffer.from(await r.arrayBuffer()));
  console.log('musique', name);
}
for (const [name, text] of Object.entries(SFX)) {
  if (only.length && !only.includes(name)) continue;
  const r = await fetch('https://api.elevenlabs.io/v1/sound-generation', { method: 'POST', headers: { 'xi-api-key': KEY, 'Content-Type': 'application/json' }, body: JSON.stringify({ text, duration_seconds: name === 'tictac' || name === 'oiseaux' ? 6 : 2, prompt_influence: 0.6 }) });
  if (!r.ok) { console.error(name, r.status, (await r.text()).slice(0, 300)); continue; }
  fs.writeFileSync(new URL(`${name}.mp3`, OUT), Buffer.from(await r.arrayBuffer()));
  console.log('bruitage', name);
}
