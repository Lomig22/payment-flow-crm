import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const db = supabase as any;

  // Fetch existing to check ownership
  const { data: existing } = await db.from('social_accounts').select('created_by').eq('id', params.id).single();
  if (!existing) return NextResponse.json({ message: 'Compte introuvable' }, { status: 404 });
  if (user.role !== 'admin' && existing.created_by !== user.id) return forbidden();

  const body = await request.json();
  const { platform, account_name, username, login, password, url, notes, assigned_to } = body;

  if (platform && !['instagram', 'facebook'].includes(platform)) {
    return NextResponse.json({ message: 'Plateforme invalide' }, { status: 400 });
  }

  const { data, error } = await db
    .from('social_accounts')
    .update({ platform, account_name, username: username || null, login: login || null, password: password || null, url: url || null, notes: notes || null, assigned_to: assigned_to || null })
    .eq('id', params.id)
    .select()
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const db = supabase as any;

  const { data: existing } = await db.from('social_accounts').select('created_by').eq('id', params.id).single();
  if (!existing) return NextResponse.json({ message: 'Compte introuvable' }, { status: 404 });
  if (user.role !== 'admin' && existing.created_by !== user.id) return forbidden();

  const { error } = await db.from('social_accounts').delete().eq('id', params.id);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
