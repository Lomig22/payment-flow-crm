import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';

// Fichiers temporaires laissés par un traitement vidéo coupé (limite de 5 min d'une fonction
// Vercel) : le disque /tmp (512 Mo, partagé entre les appels d'une même instance) se remplissait et
// les traitements suivants échouaient en « No space left on device » (imports le 13/10/2026, voix off
// le 14/10). Appelé au début de chaque traitement vidéo : tout fichier de plus de 6 min est supprimé
// (un traitement en cours dans la même instance a moins de 5 min).
export async function purgeStaleTmp(maxAgeMs = 6 * 60_000): Promise<number> {
  const dir = os.tmpdir();
  const limit = Date.now() - maxAgeMs;
  let removed = 0;
  for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, name);
    const st = await fs.stat(p).catch(() => null);
    if (st?.isFile() && st.mtimeMs < limit) { await fs.rm(p, { force: true }).catch(() => {}); removed++; }
  }
  return removed;
}
