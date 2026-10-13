import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { END_CARD_PATH, endCardExists } from '@/lib/endCard';
import { hasCronKey } from '@/lib/cronAuth';

// Séquence de fin CTA : état, URL d'envoi (remplace l'actuelle), suppression
export const dynamic = 'force-dynamic';
const BUCKET = 'content-media';

// Admin connecté, ou appel machine avec la clé CRON_SECRET (dépôt de la fin depuis le Mac)
async function guard(request: NextRequest) {
  if (hasCronKey(request)) return null;
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  return null;
}

export async function GET(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  if (!(await endCardExists())) return NextResponse.json({ url: null });
  const url = supabase.storage.from(BUCKET).getPublicUrl(END_CARD_PATH).data.publicUrl;
  return NextResponse.json({ url: `${url}?v=${Date.now()}` });
}

export async function POST(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  const { file_name, file_size } = await request.json();
  if (!/\.(mp4|mov)$/i.test(file_name ?? '')) return badRequest('Vidéo MP4 ou MOV attendue');
  if (Number(file_size) > 50 * 1024 * 1024) return badRequest('50 Mo maximum');
  await supabase.storage.from(BUCKET).remove([END_CARD_PATH]);
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(END_CARD_PATH, { upsert: true });
  if (error || !data) return NextResponse.json({ message: error?.message ?? 'Stockage indisponible' }, { status: 500 });
  return NextResponse.json({ upload_url: data.signedUrl });
}

export async function DELETE(request: NextRequest) {
  const denied = await guard(request); if (denied) return denied;
  await supabase.storage.from(BUCKET).remove([END_CARD_PATH]);
  return NextResponse.json({ ok: true });
}
