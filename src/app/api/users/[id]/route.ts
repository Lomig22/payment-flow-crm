import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin' && user.id !== params.id) return forbidden();

  const { data, error } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, role, is_active, avatar_url, created_at, acquisition_sources')
    .eq('id', params.id)
    .single();

  if (error || !data) return notFound('Utilisateur introuvable');
  return NextResponse.json(data);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin' && user.id !== params.id) return forbidden();

  const body = await request.json();
  const updates: Record<string, unknown> = {};

  const selfFields = ['first_name', 'last_name', 'avatar_url'];
  const adminFields = ['role', 'is_active', 'acquisition_sources'];
  const allowed = user.role === 'admin' ? [...selfFields, ...adminFields] : selfFields;

  for (const field of allowed) {
    if (body[field] !== undefined) updates[field] = body[field];
  }

  if (body.password && body.password.length >= 8) {
    updates.password_hash = await bcrypt.hash(body.password, 10);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { data, error } = await supabase
    .from('users')
    .update(updates)
    .eq('id', params.id)
    .select('id, email, first_name, last_name, role, is_active, avatar_url, acquisition_sources')
    .single();

  if (error || !data) return notFound('Utilisateur introuvable');
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  if (user.id === params.id) {
    return NextResponse.json({ message: 'Impossible de supprimer votre propre compte' }, { status: 400 });
  }

  const { data, error } = await supabase.from('users').delete().eq('id', params.id).select('id').single();
  if (error || !data) return notFound('Utilisateur introuvable');
  return NextResponse.json({ message: 'Utilisateur supprimé', id: params.id });
}
