import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasCronKey } from '@/lib/cronAuth';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';

// Import depuis Google Drive (script Apps Script du compte propriétaire du dossier
// REELS) : crée l'entrée « À valider » dans la file et renvoie une URL signée
// pour envoyer la vidéo directement dans Storage. Protégé par CRON_SECRET.
export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });

  const { file_name, file_size, format = 'reel' } = await request.json();
  if (!['reel', 'story'].includes(format)) return NextResponse.json({ message: 'Format invalide' }, { status: 400 });
  if (!file_name || !/\.(mp4|mov)$/i.test(file_name)) {
    return NextResponse.json({ message: 'Vidéo MP4 ou MOV attendue' }, { status: 400 });
  }

  const db = supabase as any;
  const { data: tok } = await db.from('instagram_tokens').select('account_username').order('account_username').limit(1).maybeSingle();
  const { data: row, error } = await db.from('content_queue').insert({
    account_username: tok?.account_username ?? 'lomig_guegueniat',
    format,
    file_name,
    file_size: Number(file_size) || null,
  }).select('id').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const ext = file_name.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  const { data: signed, error: signErr } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(`raw/${row.id}.${ext}`);
  if (signErr || !signed) {
    await db.from('content_queue').delete().eq('id', row.id);
    return NextResponse.json({ message: signErr?.message ?? 'Stockage indisponible' }, { status: 500 });
  }
  return NextResponse.json({ id: row.id, upload_url: signed.signedUrl }, { status: 201 });
}
