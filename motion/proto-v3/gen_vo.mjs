// Voix off : une phrase par scène (vo/script.json), voix ElevenLabs, prononciation corrigée par
// ../lib/pronounce.json. Usage : node --env-file=../../.env.local gen_vo.mjs <voix> [indices…]
import fs from 'node:fs';
const VOICES = { anatole: 'Jrq4GqCKqYpigdQsZRkP', anna: 'nVPCtAFzgyMX3FZKNzH0' };
const [voice = 'anatole', ...only] = process.argv.slice(2);
const rules = Object.entries(JSON.parse(fs.readFileSync(new URL('../lib/pronounce.json', import.meta.url))))
  .filter(([k]) => !k.startsWith('_'));
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const pronounce = (t) => rules.reduce((x, [k, v]) => x.replace(new RegExp(`(?<![\\p{L}])${esc(k)}(?![\\p{L}])`, 'giu'), v), t);
const lines = JSON.parse(fs.readFileSync('vo/script.json', 'utf8'));
for (let i = 0; i < lines.length; i++) {
  if (only.length && !only.includes(String(i))) continue;
  const text = pronounce(lines[i]);
  const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICES[voice]}?output_format=mp3_44100_128`, {
    method: 'POST', headers: { 'xi-api-key': process.env.ELEVENLABS_API_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5', language_code: 'fr',
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.3, speed: 1.12, use_speaker_boost: true } }),
  });
  if (!r.ok) { console.error(voice, i, r.status, await r.text()); continue; }
  fs.writeFileSync(`vo/${voice}-${i}.mp3`, Buffer.from(await r.arrayBuffer()));
  console.log(i, text);
}
