import { NextRequest, NextResponse } from 'next/server';
import { promises as fs } from 'fs';
import os from 'os';
import path from 'path';
import { hasCronKey } from '@/lib/cronAuth';
import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import { reframeVertical } from '@/lib/videoClean';

// Republication en vertical d'un reel publié à l'horizontale (16/10/2026) : la vidéo publiée (voix off
// et sous-titres compris) est remise en 1080 × 1920 sur fond flouté, puis programmée dans quelques
// minutes avec la même légende. POST { id, in_minutes? }. Protégé par CRON_SECRET.
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const { id, in_minutes } = await request.json().catch(() => ({}));
  const db = supabase as any;
  const { data: src } = await db.from('content_queue').select('*').eq('id', id).single();
  if (!src?.storage_path) return NextResponse.json({ message: 'Reel introuvable' }, { status: 404 });

  const tmpIn = path.join(os.tmpdir(), `${id}-src.mp4`), tmpOut = path.join(os.tmpdir(), `${id}-vertical.mp4`);
  try {
    const { data: blob, error } = await supabase.storage.from(MEDIA_BUCKET).download(src.storage_path);
    if (error || !blob) throw new Error(`Vidéo introuvable : ${error?.message ?? ''}`);
    await fs.writeFile(tmpIn, Buffer.from(await blob.arrayBuffer()));
    await reframeVertical(tmpIn, tmpOut);

    const { data: row, error: insErr } = await db.from('content_queue').insert({
      account_username: src.account_username, format: 'reel', caption: src.caption, caption_ai: src.caption_ai, caption_source: src.caption_source,
      file_name: `${src.file_name ?? 'reel'} (vertical)`, status: 'uploading',
      clean_report: { ...(src.clean_report ?? {}), reframed: { from: 'horizontal', to: '1080x1920', repost_of: src.id } },
      lossless: true, frame_paths: src.frame_paths, republish_of: src.ig_media_id ?? null,
    }).select('id').single();
    if (insErr) throw new Error(insErr.message);
    const storage_path = `clean/${row.id}.mp4`;
    const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET).upload(storage_path, await fs.readFile(tmpOut), { contentType: 'video/mp4', upsert: true });
    if (upErr) throw new Error(`Stockage : ${upErr.message}`);
    const scheduled_at = new Date(Date.now() + Math.max(1, Number(in_minutes) || 3) * 60_000).toISOString();
    await db.from('content_queue').update({
      status: 'scheduled', scheduled_at, storage_path,
      media_url: supabase.storage.from(MEDIA_BUCKET).getPublicUrl(storage_path).data.publicUrl, updated_at: new Date().toISOString(),
    }).eq('id', row.id);
    return NextResponse.json({ id: row.id, scheduled_at });
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 500 });
  } finally {
    await fs.rm(tmpIn, { force: true }); await fs.rm(tmpOut, { force: true });
  }
}
