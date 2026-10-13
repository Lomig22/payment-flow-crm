import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { supabase } from '@/lib/supabase';
import { appendEndCard } from '@/lib/videoClean';

// Séquence de fin (CTA « Commente DEVIS ») montée une fois par Lomig sur CapCut, déposée
// dans le CRM et ajoutée à la fin de chaque reel (nouveaux reels + historique envoyé sur YouTube).
export const END_CARD_PATH = 'assets/cta-end.mp4';
const BUCKET = 'content-media';

export async function endCardExists(): Promise<boolean> {
  const { data } = await supabase.storage.from(BUCKET).list('assets', { search: 'cta-end.mp4' });
  return !!data?.some((f) => f.name === 'cta-end.mp4');
}

// Ajoute la fin à une vidéo locale. Renvoie le chemin du résultat (ou l'original sans fin déposée).
export async function withEndCard(videoPath: string, tag: string): Promise<{ path: string; appended: boolean }> {
  const { data: blob } = await supabase.storage.from(BUCKET).download(END_CARD_PATH);
  if (!blob) return { path: videoPath, appended: false };
  const card = path.join(os.tmpdir(), `${tag}-card.mp4`);
  const out  = path.join(os.tmpdir(), `${tag}-cta.mp4`);
  try {
    await fs.writeFile(card, Buffer.from(await blob.arrayBuffer()));
    await appendEndCard(videoPath, card, out);
    return { path: out, appended: true };
  } finally {
    await fs.rm(card, { force: true });
  }
}
