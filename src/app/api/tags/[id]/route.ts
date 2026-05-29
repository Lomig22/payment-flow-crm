import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { name, color } = await request.json();
  const updates: Record<string, unknown> = {};
  if (name !== undefined) updates.name = name;
  if (color !== undefined) updates.color = color;

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ message: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  const { data, error } = await supabase.from('tags').update(updates).eq('id', params.id).select().single();
  if (error || !data) return notFound('Tag introuvable');
  return NextResponse.json(data);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { data, error } = await supabase.from('tags').delete().eq('id', params.id).select('id').single();
  if (error || !data) return notFound('Tag introuvable');
  return NextResponse.json({ message: 'Tag supprimé', id: params.id });
}
