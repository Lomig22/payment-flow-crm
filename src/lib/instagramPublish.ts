import { supabase } from '@/lib/supabase';
import { fixEscapedEmoji } from '@/lib/utils';
import { getAccountToken, igGet, igPost } from '@/lib/instagramGraph';
import { findDuplicate, queueFrameHashes, describeDuplicate, isFactoryFile } from '@/lib/duplicates';
import { pendingCrossPost, cleanupPublishedFiles } from '@/lib/crosspost';

// Publication des vidéos de la file (content_queue) via l'API Instagram :
// 1. création d'un conteneur (Instagram télécharge la vidéo depuis media_url),
// 2. attente du traitement (status_code FINISHED),
// 3. publication, puis suppression du fichier dans Storage.
// Si le traitement n'est pas fini dans le temps imparti, la ligne reste en
// « publishing » et la prochaine exécution (cron) reprend là où on en était.

export const MEDIA_BUCKET = 'content-media';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface QueueRow {
  id: string; account_username: string; format: 'reel' | 'story'; caption: string | null;
  status: string; media_url: string | null; storage_path: string | null;
  ig_container_id: string | null; attempts: number;
  cover_url?: string | null;   // couverture dédiée (reels de la fabrique), sinon la première image
}

async function update(id: string, fields: Record<string, unknown>) {
  await (supabase as any).from('content_queue').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', id);
}

async function fail(row: QueueRow, message: string) {
  await update(row.id, { status: 'failed', error: message });
}

// Conteneur Instagram : Instagram télécharge et traite la vidéo (20 s à quelques minutes)
async function createContainer(row: QueueRow, tok: { ig_user_id: string; access_token: string }): Promise<string> {
  if (!row.media_url) throw new Error('Vidéo introuvable');
  const params: Record<string, string> = row.format === 'reel'
    ? { media_type: 'REELS', video_url: row.media_url, caption: fixEscapedEmoji(row.caption ?? ''), share_to_feed: 'true', ...(row.cover_url ? { cover_url: row.cover_url } : {}) }
    : { media_type: 'STORIES', video_url: row.media_url };
  const c = await igPost<{ id: string }>(`${tok.ig_user_id}/media`, tok.access_token, params);
  await update(row.id, { ig_container_id: c.id, attempts: row.attempts + 1, error: null });
  return c.id;
}

// Préparation en avance : les contenus programmés dans les 25 prochaines minutes sont
// envoyés à Instagram tout de suite, pour qu'à l'heure prévue il ne reste qu'à publier.
const PREPARE_AHEAD_MS = 25 * 60_000;

async function prepareUpcoming(deadline: number): Promise<number> {
  const db = supabase as any;
  const { data: rows } = await db.from('content_queue')
    .select('id, account_username, format, caption, status, media_url, storage_path, ig_container_id, attempts, clean_report, cover_url')
    .eq('status', 'scheduled').is('ig_container_id', null)
    .gt('scheduled_at', new Date().toISOString())
    .lte('scheduled_at', new Date(Date.now() + PREPARE_AHEAD_MS).toISOString())
    .order('scheduled_at', { ascending: true })
    .limit(3);
  let prepared = 0;
  const { voiceoverBlocks } = await import('@/lib/voiceover');
  for (const row of (rows ?? []) as QueueRow[]) {
    if (Date.now() >= deadline) break;
    // Voix off pas encore montée et vérifiée : le conteneur attendra la vidéo définitive
    if (row.format === 'reel' && voiceoverBlocks((row as any).clean_report)) continue;
    const tok = await getAccountToken(row.account_username);
    if (!tok) continue;
    try { await createContainer(row, tok); prepared++; } catch { /* nouvel essai au passage suivant ou à l'heure prévue */ }
  }
  return prepared;
}

// Publie une ligne déjà réclamée (status = publishing). Renvoie le statut final.
export async function publishQueueItem(row: QueueRow, deadline: number): Promise<string> {
  const tok = await getAccountToken(row.account_username);
  if (!tok) { await fail(row, `Compte @${row.account_username} non connecté à l'API`); return 'failed'; }
  if (!row.media_url) { await fail(row, 'Vidéo introuvable'); return 'failed'; }

  // Conteneur normalement préparé en avance (prepareUpcoming) ; sinon on le crée maintenant
  let containerId = row.ig_container_id;
  if (!containerId) {
    try {
      containerId = await createContainer(row, tok);
    } catch (e: any) {
      if (row.attempts + 1 >= 3) await fail(row, e.message);
      else await update(row.id, { attempts: row.attempts + 1, error: e.message });
      return 'publishing';
    }
  }

  // Traitement de la vidéo par Instagram (quelques secondes à quelques minutes)
  while (Date.now() < deadline) {
    const s = await igGet<{ status_code: string; status?: string }>(containerId, tok.access_token, { fields: 'status_code,status' });
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'EXPIRED') {
      // Conteneur préparé il y a plus de 24 h : on le recrée au passage suivant
      await update(row.id, { ig_container_id: null });
      return 'publishing';
    }
    if (s.status_code === 'ERROR') {
      await fail(row, `Instagram a refusé la vidéo : ${s.status ?? s.status_code}`);
      return 'failed';
    }
    if (s.status_code === 'PUBLISHED') break;
    await sleep(4000);
  }
  const s = await igGet<{ status_code: string }>(containerId, tok.access_token, { fields: 'status_code' });
  if (s.status_code !== 'FINISHED' && s.status_code !== 'PUBLISHED') return 'publishing'; // reprise au prochain passage

  // Une autre exécution a pu publier entre-temps
  const { data: fresh } = await (supabase as any).from('content_queue').select('status').eq('id', row.id).single();
  if (fresh?.status === 'published') return 'published';

  // Anti-doublon de dernière minute : la vidéo a pu être postée à la main depuis l'import
  if (row.format === 'reel') {
    const { data: full } = await (supabase as any).from('content_queue').select('id, clean_report, frame_paths, republish_of, file_name').eq('id', row.id).single();
    // Republication volontaire d'un reel : autorisée par définition
    const dup = full && !full.republish_of && !isFactoryFile(full.file_name) ? await findDuplicate(row.account_username, await queueFrameHashes(full), row.id, true) : null;
    if (dup) { await fail(row, `Publication annulée — ${describeDuplicate(dup)}`); return 'failed'; }
  }

  let mediaId: string;
  try {
    mediaId = (await igPost<{ id: string }>(`${tok.ig_user_id}/media_publish`, tok.access_token, { creation_id: containerId })).id;
  } catch (e: any) {
    // Publication simultanée (bouton + tâche automatique) : l'autre a déjà publié
    const { data: again } = await (supabase as any).from('content_queue').select('status').eq('id', row.id).single();
    if (again?.status === 'published') return 'published';
    await fail(row, e.message);
    return 'failed';
  }

  let permalink: string | null = null;
  try {
    permalink = (await igGet<{ permalink?: string }>(mediaId, tok.access_token, { fields: 'permalink' })).permalink ?? null;
  } catch { /* le permalien arrivera avec la synchro */ }

  const now = new Date().toISOString();
  // Cross-post Facebook / YouTube en attente : la vidéo reste dans le stockage d'ici là
  const { data: origin } = await (supabase as any).from('content_queue').select('republish_of').eq('id', row.id).single();
  const isRepublish = !!origin?.republish_of;
  const crosspost = await pendingCrossPost(row.format, isRepublish);
  await update(row.id, {
    status: 'published', ig_media_id: mediaId, permalink, published_at: now,
    error: null, crosspost,
  });

  // Compteur « Aujourd'hui » à jour tout de suite (la synchro complètera les stats)
  await (supabase as any).from('ig_content').upsert({
    ig_media_id: mediaId, account_username: row.account_username, format: row.format,
    permalink, caption: row.caption, published_at: now,
  }, { onConflict: 'ig_media_id', ignoreDuplicates: true });
  // Republication : jamais renvoyée sur YouTube par le rattrapage de l'historique
  if (isRepublish) {
    await (supabase as any).from('ig_content')
      .update({ youtube: { status: 'skipped', error: "Republication d'un reel déjà envoyé" } }).eq('ig_media_id', mediaId);
  }

  if (!Object.keys(crosspost).length) {
    const { data: files } = await (supabase as any).from('content_queue').select('frame_paths').eq('id', row.id).single();
    await cleanupPublishedFiles(row.id, row.storage_path, files?.frame_paths ?? null);
  }
  return 'published';
}

// Publie tout ce qui est dû, dans le temps imparti (appelé par le cron).
export async function publishDue(budgetMs: number): Promise<{ id: string; status: string }[]> {
  const deadline = Date.now() + budgetMs;
  const db = supabase as any;
  const { data: rows } = await db
    .from('content_queue')
    .select('id, account_username, format, caption, status, media_url, storage_path, ig_container_id, attempts, clean_report, cover_url')
    .or(`status.eq.publishing,and(status.eq.scheduled,scheduled_at.lte.${new Date().toISOString()})`)
    .order('scheduled_at', { ascending: true })
    .limit(10);

  const results: { id: string; status: string }[] = [];
  const { voiceoverBlocks } = await import('@/lib/voiceover');
  for (const row of (rows ?? []) as QueueRow[]) {
    if (Date.now() >= deadline) break;
    // Règle 0 : un reel sans voix off montée et vérifiée (ou avec une voix étrangère détectée
    // dans le rendu) ne part pas ; il reste programmé et partira dès que la voix off sera prête
    if (row.status === 'scheduled' && row.format === 'reel' && voiceoverBlocks((row as any).clean_report)) continue;
    if (row.status === 'scheduled') {
      // Réclamation atomique : une seule exécution publie une ligne donnée
      const { data: claimed } = await db.from('content_queue')
        .update({ status: 'publishing', updated_at: new Date().toISOString() })
        .eq('id', row.id).eq('status', 'scheduled')
        .select('id');
      if (!claimed?.length) continue;
    }
    try {
      results.push({ id: row.id, status: await publishQueueItem(row, deadline) });
    } catch (e: any) {
      await update(row.id, { error: e.message });
      results.push({ id: row.id, status: 'error' });
    }
  }
  // Temps restant : préparer les publications des 25 prochaines minutes
  await prepareUpcoming(deadline);
  return results;
}
