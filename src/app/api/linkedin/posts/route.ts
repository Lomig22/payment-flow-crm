import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { MEDIA_BUCKET } from '@/lib/instagramPublish';
import { connection, fillPosts, postSettings, withCta } from '@/lib/linkedinPosts';

// Page Posts LinkedIn : connexion du profil, photos, posts programmés / publiés et retours de Lomig
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const db = () => supabase as any;
const url = (path: string) => supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path).data.publicUrl;

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const since = new Date(Date.now() - 3 * 86400_000).toISOString();
  const [{ data: posts }, { data: photos }, conn, settings] = await Promise.all([
    db().from('linkedin_posts').select('*').neq('status', 'cancelled').gte('scheduled_at', since).order('scheduled_at').limit(60),
    db().from('linkedin_photos').select('*').order('created_at', { ascending: false }),
    connection(),
    postSettings(),
  ]);
  const photoUrl = new Map((photos ?? []).map((p: any) => [p.id, url(p.storage_path)]));
  return NextResponse.json({
    connection: conn, settings,
    photos: (photos ?? []).map((p: any) => ({ ...p, url: photoUrl.get(p.id) })),
    posts: (posts ?? []).map((p: any) => ({ ...p, photo_url: p.photo_id ? photoUrl.get(p.photo_id) ?? null : null })),
  });
}

// Actions : cancel / feedback / edit (un post), photo_upload_url / photo_add / photo_delete, fill (écrire maintenant)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const b = await request.json().catch(() => ({}));
  const now = new Date().toISOString();
  switch (b.action) {
    case 'cancel':
      await db().from('linkedin_posts').update({ status: 'cancelled', feedback: b.feedback?.trim() || null, updated_at: now }).eq('id', b.id).eq('status', 'scheduled');
      return NextResponse.json({ ok: true });
    case 'settings': {
      // Modèle du CTA : même mot pour tous les posts ; appliqué aussi aux posts pas encore publiés
      const keyword = String(b.cta_keyword ?? '').normalize('NFD').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 20);
      const template = String(b.cta_template ?? '').trim().slice(0, 300);
      if (!keyword || !template.includes('{mot}')) return badRequest('Il faut un mot et une phrase qui contient {mot}');
      await db().from('linkedin_post_settings').update({ cta_keyword: keyword, cta_template: template, updated_at: now }).eq('id', 1);
      const tpl = { cta_keyword: keyword, cta_template: template };
      const { data: open } = await db().from('linkedin_posts').select('id, body, resource_title').eq('status', 'scheduled');
      for (const p of open ?? []) await db().from('linkedin_posts').update({ body: withCta(p.body, tpl, p.resource_title), keyword, updated_at: now }).eq('id', p.id);
      return NextResponse.json({ ok: true, updated: (open ?? []).length });
    }
    case 'approve':
    case 'unapprove':
      await db().from('linkedin_posts').update({ approved_at: b.action === 'approve' ? now : null, updated_at: now }).eq('id', b.id).eq('status', 'scheduled');
      return NextResponse.json({ ok: true });
    case 'feedback':
      await db().from('linkedin_posts').update({ feedback: b.feedback?.trim() || null, updated_at: now }).eq('id', b.id);
      return NextResponse.json({ ok: true });
    case 'edit':
      if (!String(b.body ?? '').trim()) return badRequest('Texte vide');
      await db().from('linkedin_posts').update({ body: String(b.body), photo_id: b.photo_id ?? null, updated_at: now }).eq('id', b.id).eq('status', 'scheduled');
      return NextResponse.json({ ok: true });
    case 'photo_upload_url': {
      const ext = /png$/i.test(b.name ?? '') ? 'png' : 'jpg';
      const path = `linkedin/photos/${randomUUID()}.${ext}`;
      const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUploadUrl(path);
      if (error || !data) return NextResponse.json({ message: error?.message ?? 'Stockage indisponible' }, { status: 500 });
      return NextResponse.json({ path, token: data.token, signed_url: data.signedUrl });
    }
    case 'photo_add':
      if (!String(b.path ?? '').startsWith('linkedin/photos/')) return badRequest('Chemin invalide');
      await db().from('linkedin_photos').insert({ storage_path: b.path, label: b.label ?? null });
      return NextResponse.json({ ok: true });
    case 'photo_delete': {
      const { data: p } = await db().from('linkedin_photos').select('storage_path').eq('id', b.id).single();
      await db().from('linkedin_photos').delete().eq('id', b.id);
      if (p) await supabase.storage.from(MEDIA_BUCKET).remove([p.storage_path]);
      return NextResponse.json({ ok: true });
    }
    case 'fill':
      return NextResponse.json(await fillPosts());
    default:
      return badRequest('Action inconnue');
  }
}
