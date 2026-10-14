import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { supabase } from '@/lib/supabase';
import { imageDHash, hashDistance } from '@/lib/videoClean';

// Anti-doublon : une vidéo est comparée (empreintes visuelles de ses 6 images) aux
// miniatures des contenus déjà publiés sur le compte ET aux vidéos déjà dans la file.
// Vérifié à l'import, puis de nouveau juste avant la publication (un reel a pu être
// posté à la main entre-temps).

// Distance max (sur 64 bits) pour considérer deux images identiques.
// Mesuré : ~8 pour un reel déjà posté, ≥ 20 entre deux reels différents.
const MAX_DISTANCE = 12;

export interface Duplicate {
  source:       'published' | 'queue';
  distance:     number;
  permalink:    string | null;
  published_at: string | null;
  label:        string | null;   // légende ou nom de fichier
}

// Reels de la fabrique (compte agence) : même décor et même fin d'un reel à l'autre, donc
// l'empreinte visuelle les confondrait ; chacun est écrit pour l'occasion, pas de doublon possible
export const isFactoryFile = (name?: string | null) => !!name?.startsWith('fabrique-');

const closest = (frameHashes: string[], other: string[]) =>
  Math.min(...frameHashes.flatMap((h) => other.map((o) => hashDistance(h, o))));

// `beforePublish` : seules les vidéos de la file déjà publiées (ou en cours) comptent,
// pour que deux copies programmées ne se bloquent pas mutuellement.
export async function findDuplicate(account: string, frameHashes: string[], excludeQueueId?: string, beforePublish = false): Promise<Duplicate | null> {
  if (!frameHashes.length) return null;
  const db = supabase as any;
  const [{ data: published }, { data: queued }] = await Promise.all([
    db.from('ig_content').select('permalink, published_at, caption, thumb_hash')
      .eq('account_username', account).in('format', ['reel', 'post', 'carousel']).not('thumb_hash', 'is', null),
    db.from('content_queue').select('id, file_name, caption, permalink, published_at, clean_report')
      .eq('account_username', account).in('status', beforePublish ? ['publishing', 'published'] : ['draft', 'scheduled', 'publishing', 'published']),
  ]);

  let best: Duplicate | null = null;
  const consider = (d: Duplicate) => { if (d.distance <= MAX_DISTANCE && (!best || d.distance < best.distance)) best = d; };

  for (const p of published ?? []) {
    consider({ source: 'published', distance: closest(frameHashes, [p.thumb_hash]), permalink: p.permalink, published_at: p.published_at, label: p.caption });
  }
  for (const q of queued ?? []) {
    const hashes: string[] = q.clean_report?.frame_hashes ?? [];
    if (q.id === excludeQueueId || !hashes.length) continue;
    consider({ source: 'queue', distance: closest(frameHashes, hashes), permalink: q.permalink, published_at: q.published_at, label: q.caption ?? q.file_name });
  }
  return best;
}

// Empreintes d'une vidéo de la file : enregistrées à l'import, sinon recalculées
// depuis ses images (vidéos importées avant la mise en place de l'anti-doublon)
export async function queueFrameHashes(row: { id: string; clean_report: any; frame_paths: string[] | null }): Promise<string[]> {
  if (row.clean_report?.frame_hashes?.length) return row.clean_report.frame_hashes;
  const out: string[] = [];
  for (const p of row.frame_paths ?? []) {
    const tmp = path.join(os.tmpdir(), `dup-${row.id}-${path.basename(p)}`);
    try {
      const { data } = await supabase.storage.from('content-media').download(p);
      if (!data) continue;
      await fs.writeFile(tmp, Buffer.from(await data.arrayBuffer()));
      out.push(await imageDHash(tmp));
    } catch { /* image indisponible */ } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  return out;
}

export function describeDuplicate(d: Duplicate): string {
  const when = d.published_at ? new Date(d.published_at).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'long' }) : null;
  return d.source === 'published' || d.permalink
    ? `Déjà publié${when ? ` le ${when}` : ''}${d.permalink ? ` : ${d.permalink}` : ''}`
    : `Déjà dans la file de publication (${(d.label ?? '').split('\n')[0].slice(0, 60)})`;
}
