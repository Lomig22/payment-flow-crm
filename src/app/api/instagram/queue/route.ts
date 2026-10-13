import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';

// File de publication Instagram : liste + création d'une entrée (renvoie une URL
// signée pour envoyer la vidéo directement dans Storage, sans passer par Vercel).
export const dynamic = 'force-dynamic';

const COLUMNS = 'id, account_username, format, caption, caption_ai, caption_source, media_url, frame_paths, crosspost, status, scheduled_at, file_name, file_size, clean_report, lossless, permalink, published_at, error, attempts, created_at';

async function defaultAccount(): Promise<string> {
  const { data } = await (supabase as any).from('instagram_tokens').select('account_username').order('account_username').limit(1);
  return data?.[0]?.account_username ?? 'lomig_guegueniat';
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  // À venir + tout ce qui a bougé ces 7 derniers jours
  const since = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const { data, error } = await (supabase as any)
    .from('content_queue')
    .select(COLUMNS)
    .or(`status.in.(uploading,draft,scheduled,publishing),updated_at.gte.${since}`)
    .order('scheduled_at', { ascending: true, nullsFirst: false })
    .order('created_at', { ascending: true });
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  // Vignette (première image extraite) pour l'aperçu
  return NextResponse.json((data ?? []).map(({ frame_paths, ...r }: any) => ({
    ...r,
    cover_url: frame_paths?.[0] ? supabase.storage.from(MEDIA_BUCKET).getPublicUrl(frame_paths[0]).data.publicUrl : null,
  })));
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { format, caption, scheduled_at, file_name, file_size } = await request.json();
  // Limite par fichier du stockage Supabase (offre gratuite) : refus clair avant l'envoi
  if (Number(file_size) > 50 * 1_048_576) {
    return NextResponse.json({ message: `Vidéo de ${Math.round(Number(file_size) / 1_048_576)} Mo : 50 Mo maximum` }, { status: 400 });
  }
  if (!['reel', 'story'].includes(format)) return badRequest('Format invalide (reel ou story)');
  if (!file_name || !/\.(mp4|mov)$/i.test(file_name)) return badRequest('Vidéo MP4 ou MOV attendue');
  if (caption && caption.length > 2200) return badRequest('Légende trop longue (2 200 caractères max)');
  if (scheduled_at && Number.isNaN(Date.parse(scheduled_at))) return badRequest('Date de publication invalide');

  const db = supabase as any;
  // Même fichier (nom + taille) déjà envoyé ces 7 derniers jours : refusé avant l'envoi. Sans ce
  // contrôle, un fichier déposé deux fois était traité en parallèle et programmé en double (13/10/2026)
  if (Number(file_size)) {
    const { data: same } = await db.from('content_queue').select('id, status')
      .eq('file_name', file_name).eq('file_size', Number(file_size)).neq('status', 'failed')
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString()).limit(1);
    if (same?.length) return NextResponse.json({ message: 'Déjà envoyée (même fichier dans la file)' }, { status: 409 });
  }
  const { data: row, error } = await db
    .from('content_queue')
    .insert({
      account_username: await defaultAccount(),
      format,
      caption:      format === 'reel' ? caption || null : null,
      caption_source: format === 'reel' && caption ? 'manual' : null,
      scheduled_at: scheduled_at || null,
      file_name,
      file_size:    Number(file_size) || null,
      created_by:   user.id,
    })
    .select('id')
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const ext = file_name.toLowerCase().endsWith('.mov') ? 'mov' : 'mp4';
  const { data: signed, error: signErr } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUploadUrl(`raw/${row.id}.${ext}`);
  if (signErr || !signed) {
    await db.from('content_queue').delete().eq('id', row.id);
    return NextResponse.json({ message: signErr?.message ?? 'Stockage indisponible' }, { status: 500 });
  }

  return NextResponse.json({ id: row.id, upload_url: signed.signedUrl }, { status: 201 });
}
