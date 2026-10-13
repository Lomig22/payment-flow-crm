import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { fixEscapedEmoji } from '@/lib/utils';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import { voiceoverBlocks } from '@/lib/voiceover';

// Modifier une entrée de la file (légende, heure, brouillon ↔ programmé,
// relancer un échec) ou la supprimer.
export const dynamic = 'force-dynamic';

export async function PATCH(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { data: row } = await db.from('content_queue').select('*').eq('id', params.id).single();
  if (!row) return notFound('Contenu introuvable');
  if (['publishing', 'published', 'uploading'].includes(row.status)) {
    return badRequest('Ce contenu ne peut plus être modifié');
  }

  const body = await request.json();
  const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };

  if (body.caption !== undefined) {
    if (String(body.caption).length > 2200) return badRequest('Légende trop longue (2 200 caractères max)');
    updates.caption = row.format === 'reel' ? fixEscapedEmoji(body.caption || null) : null;
    if (updates.caption !== row.caption) {
      updates.ig_container_id = null;   // conteneur préparé avec l'ancienne légende : à refaire
      updates.caption_source = row.caption_source === 'ai' || row.caption_source === 'ai_edited' ? 'ai_edited' : 'manual';
    }
  }
  if (body.scheduled_at !== undefined) {
    if (body.scheduled_at && Number.isNaN(Date.parse(body.scheduled_at))) return badRequest('Date invalide');
    updates.scheduled_at = body.scheduled_at || null;
  }
  if (body.status !== undefined) {
    if (!['draft', 'scheduled'].includes(body.status)) return badRequest('Statut invalide');
    if (row.status === 'failed' && !row.media_url) return badRequest('Vidéo absente : ajoutez-la de nouveau');
    // Voix étrangère : programmation manuelle refusée tant que la voix off française n'est pas montée
    // Règle 0 de la voix off : un reel ne se programme qu'avec sa voix off montée et vérifiée
    const blocked = body.status === 'scheduled' && row.format === 'reel' ? voiceoverBlocks(row.clean_report) : null;
    if (blocked) return badRequest(blocked);
    updates.status = body.status;
    if (row.status === 'failed') Object.assign(updates, { error: null, attempts: 0, ig_container_id: null });
  }
  const scheduledAt = (updates.scheduled_at ?? row.scheduled_at) as string | null;
  if ((updates.status ?? row.status) === 'scheduled' && !scheduledAt) return badRequest('Choisissez une date de publication');

  const { data, error } = await db.from('content_queue').update(updates).eq('id', params.id).select().single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { data: row } = await db.from('content_queue').select('id, status, storage_path, file_name, frame_paths').eq('id', params.id).single();
  if (!row) return notFound('Contenu introuvable');
  if (row.status === 'publishing') return badRequest('Publication en cours, réessayez dans une minute');

  const ext = row.file_name?.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  await supabase.storage.from(MEDIA_BUCKET).remove([
    `raw/${row.id}.${ext}`, ...(row.storage_path ? [row.storage_path] : []), ...(row.frame_paths ?? []),
    `clean/${row.id}.mp4`, `clean/${row.id}-base.mp4`,   // vidéo d'origine nettoyée et base de la voix off
  ]);
  await db.from('content_queue').delete().eq('id', row.id);
  return NextResponse.json({ ok: true });
}
