import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { getAccountToken, igGet } from '@/lib/instagramGraph';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';

// Republication des meilleurs reels :
//  GET  → reels candidats (publiés depuis au moins MIN_AGE_DAYS, jamais republiés, vidéo
//         fournie par Instagram), classés par vues ;
//  POST → récupère la vidéo sur Instagram et crée l'entrée de la file (traitement et
//         légende ensuite, comme un dépôt classique).
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const MIN_AGE_DAYS = 21;

async function guard(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return { error: unauthorized() };
  if (user.role !== 'admin') return { error: forbidden() };
  return { user };
}

export async function GET(request: NextRequest) {
  const g = await guard(request); if (g.error) return g.error;
  const db = supabase as any;
  const [{ data: reels }, { data: already }] = await Promise.all([
    db.from('ig_content')
      .select('ig_media_id, caption, permalink, thumbnail_url, published_at, views, likes, comments, shares, saved, youtube')
      .eq('format', 'reel')
      .lte('published_at', new Date(Date.now() - MIN_AGE_DAYS * 86_400_000).toISOString())
      .order('views', { ascending: false, nullsFirst: false })
      .limit(80),
    db.from('content_queue').select('republish_of, status').not('republish_of', 'is', null).neq('status', 'failed'),
  ]);
  const done = new Set((already ?? []).map((r: any) => r.republish_of));
  const candidates = (reels ?? [])
    // déjà republié, ou vidéo non fournie par Instagram (musique de la bibliothèque IG)
    .filter((r: any) => !done.has(r.ig_media_id) && r.youtube?.status !== 'skipped')
    .slice(0, 20)
    .map(({ youtube, ...r }: any) => r);
  return NextResponse.json({ min_age_days: MIN_AGE_DAYS, candidates });
}

export async function POST(request: NextRequest) {
  const g = await guard(request); if (g.error) return g.error;
  const { ig_media_id } = await request.json();
  if (!ig_media_id) return badRequest('Reel à republier manquant');

  const db = supabase as any;
  const { data: reel } = await db.from('ig_content').select('ig_media_id, account_username, published_at, caption')
    .eq('ig_media_id', ig_media_id).eq('format', 'reel').maybeSingle();
  if (!reel) return badRequest('Reel introuvable');
  if (Date.now() - new Date(reel.published_at).getTime() < MIN_AGE_DAYS * 86_400_000) {
    return badRequest(`Ce reel a moins de ${MIN_AGE_DAYS} jours : trop tôt pour le republier`);
  }
  const { data: existing } = await db.from('content_queue').select('id').eq('republish_of', ig_media_id).neq('status', 'failed').limit(1);
  if (existing?.length) return badRequest('Ce reel est déjà dans la file ou a déjà été republié');

  const tok = await getAccountToken(reel.account_username);
  if (!tok) return badRequest('Compte Instagram non connecté');
  const { media_url } = await igGet<{ media_url?: string }>(ig_media_id, tok.access_token, { fields: 'media_url' });
  if (!media_url) return badRequest('Instagram ne fournit pas la vidéo de ce reel (musique de la bibliothèque Instagram)');

  const res = await fetch(media_url, { cache: 'no-store' });
  if (!res.ok) return NextResponse.json({ message: `Téléchargement Instagram impossible (${res.status})` }, { status: 502 });
  const video = Buffer.from(await res.arrayBuffer());

  const { data: row, error } = await db.from('content_queue').insert({
    account_username: reel.account_username, format: 'reel', republish_of: ig_media_id,
    file_name: `REPUBLICATION ${new Date(reel.published_at).toLocaleDateString('fr-FR')} - ${(reel.caption ?? '').split('\n')[0].slice(0, 40)}.mp4`,
    file_size: video.length, created_by: g.user!.id,
  }).select('id').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const { error: upErr } = await supabase.storage.from(MEDIA_BUCKET)
    .upload(`raw/${row.id}.mp4`, video, { contentType: 'video/mp4', upsert: true });
  if (upErr) {
    await db.from('content_queue').delete().eq('id', row.id);
    return NextResponse.json({ message: `Stockage : ${upErr.message}` }, { status: 500 });
  }
  return NextResponse.json({ id: row.id }, { status: 201 });
}
