import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { supabase } from '@/lib/supabase';
import { cleanVideo, extractFrames, imageDHash } from '@/lib/videoClean';
import { findDuplicate, describeDuplicate, isFactoryFile } from '@/lib/duplicates';
import { withEndCard } from '@/lib/endCard';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import { analyzeAudio, VOICE_ACCOUNT } from '@/lib/voiceover';
import { probe } from '@/lib/videoClean';
import { purgeStaleTmp } from '@/lib/tmpClean';

// Traitement d'une vidéo envoyée dans Storage (raw/<id>.<ext>) : suppression des
// métadonnées sans réencodage, contrôle d'intégrité (empreintes identiques),
// images pour la légende automatique, puis « programmé » (ou « brouillon » sans
// date). La vidéo brute est supprimée. Utilisé par l'upload du CRM et l'import Drive.

export class QueueProcessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

// Envois abandonnés (onglet fermé, script Drive qui a planté) : entrée restée
// « uploading » depuis plus d'une heure sans fichier complet → suppression de l'entrée et du
// fichier brut. Les entrées envoyées (uploaded_at) attendent le traitement en arrière-plan.
export async function cleanupStaleUploads(): Promise<number> {
  const db = supabase as any;
  const { data: stale } = await db.from('content_queue')
    .select('id, file_name')
    .eq('status', 'uploading')
    .is('uploaded_at', null)
    .lt('updated_at', new Date(Date.now() - 3_600_000).toISOString())
    .limit(50);
  if (!stale?.length) return 0;
  await supabase.storage.from(MEDIA_BUCKET).remove(
    stale.map((r: any) => `raw/${r.id}.${r.file_name?.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4'}`),
  );
  await db.from('content_queue').delete().in('id', stale.map((r: any) => r.id));
  return stale.length;
}

// ── Traitement en arrière-plan (sprint45) ──
// Le navigateur envoie le fichier brut puis appelle markUploaded ; le cron du VPS appelle
// processNextUploaded toutes les minutes (deux à la fois). Un traitement coupé par la limite de
// 5 min de Vercel est repris après LEASE_MS ; au bout de MAX_PROCESS_ATTEMPTS, la vidéo est en échec.
const LEASE_MS = 6 * 60_000;
export const MAX_PROCESS_ATTEMPTS = 3;

export async function markUploaded(id: string): Promise<boolean> {
  const { data } = await (supabase as any).from('content_queue')
    .update({ uploaded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', id).eq('status', 'uploading').select('id');
  return !!data?.length;
}

export async function processNextUploaded(): Promise<{ id: string; status: string; message?: string } | null> {
  const db = supabase as any;
  const free = `processing_at.is.null,processing_at.lt.${new Date(Date.now() - LEASE_MS).toISOString()}`;
  const { data } = await db.from('content_queue').select('id, file_name, process_attempts')
    .eq('status', 'uploading').not('uploaded_at', 'is', null).or(free)
    .order('uploaded_at', { ascending: true }).limit(5);
  for (const row of data ?? []) {
    if (row.process_attempts >= MAX_PROCESS_ATTEMPTS) {
      await db.from('content_queue').update({
        status: 'failed', updated_at: new Date().toISOString(),
        error: `Traitement interrompu ${MAX_PROCESS_ATTEMPTS} fois (vidéo trop longue ou trop lourde ?) : la redéposer plus courte ou compressée`,
      }).eq('id', row.id);
      await supabase.storage.from(MEDIA_BUCKET).remove([`raw/${row.id}.${row.file_name?.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4'}`]);
      continue;
    }
    // Verrou : seulement si aucun autre passage ne l'a pris entre-temps
    const { data: got } = await db.from('content_queue')
      .update({ processing_at: new Date().toISOString(), process_attempts: row.process_attempts + 1 })
      .eq('id', row.id).eq('status', 'uploading').or(free).select('id');
    if (!got?.length) continue;
    try {
      const r: any = await processQueueItem(row.id);
      return { id: row.id, status: r?.status ?? 'done', message: r?.message };
    } catch (e: any) {
      return { id: row.id, status: 'failed', message: e.message };
    }
  }
  return null;
}

export async function processQueueItem(id: string) {
  await purgeStaleTmp();
  const db = supabase as any;
  const { data: row } = await db.from('content_queue').select('id, account_username, status, format, file_name, scheduled_at, republish_of').eq('id', id).single();
  if (!row) throw new QueueProcessError('Contenu introuvable', 404);
  if (row.status !== 'uploading') throw new QueueProcessError('Vidéo déjà traitée', 409);

  const ext     = row.file_name?.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  const rawPath = `raw/${row.id}.${ext}`;
  const outPath = `clean/${row.id}.mp4`;
  const tmpIn   = path.join(os.tmpdir(), `${row.id}-in.${ext}`);
  const tmpOut  = path.join(os.tmpdir(), `${row.id}-out.mp4`);

  try {
    const { data: blob, error: dlErr } = await supabase.storage.from(MEDIA_BUCKET).download(rawPath);
    if (dlErr || !blob) throw new Error(`Vidéo non reçue : ${dlErr?.message ?? 'fichier absent'}`);
    await fs.writeFile(tmpIn, Buffer.from(await blob.arrayBuffer()));

    const report = await cleanVideo(tmpIn, tmpOut);
    if (!report.lossless) {
      throw new Error('Contrôle d\'intégrité échoué : la vidéo nettoyée ne correspond pas à l\'originale, elle ne sera pas publiée');
    }

    // Reels : séquence de fin CTA ajoutée (si déposée) ; la vidéo publiée est cette version
    let finalPath = tmpOut;
    // (republication : pas de seconde fin si le reel d'origine l'avait déjà)
    const sourceHadCard = row.republish_of
      ? !!(await db.from('content_queue').select('id').eq('ig_media_id', row.republish_of).eq('clean_report->>end_card', 'true').limit(1)).data?.length
      : false;
    // Compte agence (reels motion design générés) : voix off et appel à l'action déjà dans la
    // vidéo → ni analyse audio, ni voix off de Lomig, ni fin CTA de son compte
    const personal = row.account_username === VOICE_ACCOUNT;
    if (!personal) (report as any).voiceover = { status: 'skipped', segments: [], error: 'Compte agence : voix off déjà montée dans la vidéo', updated_at: new Date().toISOString() };
    if (row.format === 'reel' && personal) {
      // Analyse de la piste audio : une voix d'origine déclenche la voix off de Lomig. La vidéo
      // de base (sans fin CTA) n'est gardée que dans ce cas (stockage limité à 1 Go)
      const audio = await analyzeAudio(tmpOut, row.id).catch(() => undefined);
      (report as any).audio = audio;
      if (audio?.voice) {
        const basePath = `clean/${row.id}-base.mp4`;
        const { error: baseErr } = await supabase.storage.from(MEDIA_BUCKET)
          .upload(basePath, await fs.readFile(tmpOut), { contentType: 'video/mp4', upsert: true });
        if (!baseErr) (report as any).vo_base = { path: basePath, duration: (await probe(tmpOut)).duration };
      }
    }
    if (row.format === 'reel' && personal && !sourceHadCard) {
      const withCard = await withEndCard(tmpOut, row.id);
      finalPath = withCard.path;
      (report as any).end_card = withCard.appended;
    }
    const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET)
      .upload(outPath, await fs.readFile(finalPath), { contentType: 'video/mp4', upsert: true });
    if (finalPath !== tmpOut) await fs.rm(finalPath, { force: true });
    if (upErr) throw new Error(`Stockage : ${upErr.message}`);
    await supabase.storage.from(MEDIA_BUCKET).remove([rawPath]);

    const media_url = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(outPath).data.publicUrl;

    // Images de la vidéo : légende automatique + détection d'une vidéo déjà publiée (reels)
    let frame_paths: string[] | null = null;
    if (row.format === 'reel') {
      const local = await extractFrames(tmpOut, path.join(os.tmpdir(), `${row.id}-frame`));
      const hashes = (await Promise.all(local.map((f) => imageDHash(f).catch(() => null)))).filter((h): h is string => !!h);
      (report as any).frame_hashes = hashes;   // réutilisées par l'anti-doublon avant publication
      // Republication volontaire d'un reel : l'anti-doublon ne s'applique pas
      const dup    = row.republish_of || isFactoryFile(row.file_name) ? null : await findDuplicate(row.account_username, hashes, row.id);
      if (dup) {
        await Promise.all(local.map((f) => fs.rm(f, { force: true })));
        await supabase.storage.from(MEDIA_BUCKET).remove([outPath]);
        await db.from('content_queue').delete().eq('id', row.id);
        return { id: row.id, status: 'duplicate' as const, duplicate: dup, message: describeDuplicate(dup), clean_report: report, lossless: true };
      }
      frame_paths = [];
      for (let i = 0; i < local.length; i++) {
        const p = `frames/${row.id}-${i}.jpg`;
        const { error } = await supabase.storage.from(MEDIA_BUCKET)
          .upload(p, await fs.readFile(local[i]), { contentType: 'image/jpeg', upsert: true });
        if (!error) frame_paths.push(p);
        await fs.rm(local[i], { force: true });
      }
    }

    const { data: updated } = await db.from('content_queue').update({
      status:       row.scheduled_at ? 'scheduled' : 'draft',
      storage_path: outPath,
      media_url,
      clean_report: report,
      lossless:     true,
      frame_paths,
      updated_at:   new Date().toISOString(),
    }).eq('id', row.id).select('id, status, clean_report, lossless').single();
    return updated;
  } catch (e: any) {
    await db.from('content_queue').update({ status: 'failed', error: e.message, updated_at: new Date().toISOString() }).eq('id', row.id);
    await supabase.storage.from(MEDIA_BUCKET).remove([rawPath, outPath]);
    throw new QueueProcessError(e.message, 500);
  } finally {
    await Promise.all([fs.rm(tmpIn, { force: true }), fs.rm(tmpOut, { force: true })]);
  }
}
