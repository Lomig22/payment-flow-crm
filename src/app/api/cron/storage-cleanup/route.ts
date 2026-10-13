import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCronKey } from '@/lib/cronAuth';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';

// Ménage du stockage (offre gratuite Supabase : 1 Go au total). Supprime, via l'API Storage :
//   • les fichiers de reels publiés (s'il reste un cross-post en attente, seule la vidéo
//     publiée est gardée) ;
//   • les fichiers de reels en échec depuis plus de 7 jours ;
//   • les vidéos de base (voix off) de reels sans voix d'origine, et les rendus VF qui ne sont
//     plus la vidéo à publier ;
//   • les fichiers orphelins (aucune entrée de la file).
// Jamais un fichier d'un reel en attente (brouillon, programmé, en cours) n'est touché.
// ?dry=1 : liste seulement. Protégé par CRON_SECRET.
export const dynamic     = 'force-dynamic';
export const maxDuration = 120;

async function listAll(prefix: string) {
  const out: { name: string; size: number }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data } = await supabase.storage.from(MEDIA_BUCKET).list(prefix, { limit: 1000, offset });
    if (!data?.length) break;
    out.push(...data.filter((f) => f.id).map((f) => ({ name: `${prefix}/${f.name}`, size: (f.metadata as any)?.size ?? 0 })));
    if (data.length < 1000) break;
  }
  return out;
}

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  const db = supabase as any;

  const { data: rows } = await db.from('content_queue').select('id, status, storage_path, crosspost, clean_report, updated_at');
  const weekAgo = Date.now() - 7 * 86_400_000;
  const byId = new Map<string, any>((rows ?? []).map((r: any) => [r.id, r]));
  const files = [...(await listAll('clean')), ...(await listAll('frames')), ...(await listAll('raw'))];

  const remove: { name: string; size: number; why: string }[] = [];
  for (const f of files) {
    const id = f.name.split('/')[1]?.slice(0, 36);
    const row = id ? byId.get(id) : undefined;
    if (!row) {
      // raw/ récent : envoi peut-être en cours (le nettoyage des envois abandonnés s'en charge)
      if (!f.name.startsWith('raw/')) remove.push({ ...f, why: 'orphelin' });
      continue;
    }
    if (row.status === 'published') {
      const pending = Object.values(row.crosspost ?? {}).some((c: any) => c?.status === 'pending');
      if (!pending || f.name !== row.storage_path) remove.push({ ...f, why: 'reel publié' });
      continue;
    }
    if (row.status === 'failed' && new Date(row.updated_at).getTime() < weekAgo) {
      remove.push({ ...f, why: 'échec de plus de 7 jours' });
      continue;
    }
    if (f.name.endsWith('-base.mp4') && row.clean_report?.audio?.voice !== true && !row.clean_report?.vo_extra && f.name !== row.storage_path) {
      remove.push({ ...f, why: 'base inutile (pas de voix d\'origine)' });
      continue;
    }
    // Rendu voix off qui n'est plus la vidéo à publier (reel revenu à sa version d'origine)
    if (f.name.includes('-vf-') && f.name !== row.storage_path) { remove.push({ ...f, why: 'ancien rendu VF' }); continue; }
    // Original en double : la VF est la vidéo à publier et la base (sans fin CTA) permet de la refaire
    // (sauf VF en plus : l'original sert de repli si la VF est refusée)
    if (f.name === `clean/${row.id}.mp4` && String(row.storage_path ?? '').includes('-vf-') && row.clean_report?.vo_base?.path && !row.clean_report?.vo_extra) {
      remove.push({ ...f, why: 'original en double (VF montée)' });
    }
  }

  const total = (list: typeof remove) => Math.round(list.reduce((n, f) => n + f.size, 0) / 1_048_576);
  const summary = Object.fromEntries(Array.from(new Set(remove.map((f) => f.why))).map((w) => {
    const l = remove.filter((f) => f.why === w); return [w, { fichiers: l.length, mo: total(l) }];
  }));
  if (!dry) {
    for (let i = 0; i < remove.length; i += 100) {
      await supabase.storage.from(MEDIA_BUCKET).remove(remove.slice(i, i + 100).map((f) => f.name));
    }
    // Les reels publiés nettoyés n'ont plus de fichier
    const cleaned = Array.from(new Set(remove.filter((f) => f.why !== 'orphelin' && f.name === byId.get(f.name.split('/')[1].slice(0, 36))?.storage_path)
      .map((f) => f.name.split('/')[1].slice(0, 36))));
    if (cleaned.length) await db.from('content_queue').update({ storage_path: null, frame_paths: null }).in('id', cleaned);
  }
  return NextResponse.json({ dry, supprimes: remove.length, mo: total(remove), detail: summary });
}
