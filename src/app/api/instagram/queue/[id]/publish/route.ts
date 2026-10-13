import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { voiceoverBlocks } from '@/lib/voiceover';
import { publishQueueItem, type QueueRow } from '@/lib/instagramPublish';

// « Publier maintenant » : appel court et répétable. Le premier appel réclame la vidéo et
// l'envoie à Instagram ; tant qu'Instagram la traite (« publishing »), l'écran rappelle
// cette route toutes les quelques secondes, qui publie dès que la vidéo est prête.
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const COLUMNS = 'id, account_username, format, caption, status, media_url, storage_path, ig_container_id, attempts';
const STEP_MS = 10_000;   // attente maximale d'Instagram par appel

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  // Règle 0 de la voix off : pas de publication tant qu'elle n'est pas montée et vérifiée
  const { data: check } = await db.from('content_queue').select('format, clean_report').eq('id', params.id).maybeSingle();
  const blocked = check?.format === 'reel' ? voiceoverBlocks(check.clean_report) : null;
  if (blocked) return NextResponse.json({ message: blocked }, { status: 400 });
  // Premier clic : brouillon / programmé → en cours de publication, tout de suite
  const { data: claimed } = await db.from('content_queue')
    .update({ status: 'publishing', scheduled_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq('id', params.id).in('status', ['draft', 'scheduled'])
    .select(COLUMNS);

  let row: QueueRow | null = claimed?.[0] ?? null;
  if (!row) {
    // Rappel pendant le traitement Instagram : on reprend la vidéo déjà réclamée
    const { data: current } = await db.from('content_queue').select(COLUMNS).eq('id', params.id).maybeSingle();
    if (!current) return notFound('Contenu introuvable');
    if (current.status === 'published' || current.status === 'failed') {
      const { data } = await db.from('content_queue').select('id, status, permalink, error').eq('id', params.id).single();
      return NextResponse.json(data);
    }
    if (current.status !== 'publishing') return badRequest('Ce contenu n\'est pas prêt à être publié');
    row = current;
  }

  const status = await publishQueueItem(row!, Date.now() + STEP_MS);
  const { data } = await db.from('content_queue').select('id, status, permalink, error').eq('id', params.id).single();
  return NextResponse.json({ ...data, status });
}
