import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function PUT(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const body = await request.json();
  const { platform, account_name, username, url, notes, assigned_to } = body;

  if (platform && !['instagram', 'facebook'].includes(platform)) {
    return NextResponse.json({ message: 'Plateforme invalide' }, { status: 400 });
  }

  const db = supabase as any;
  const { data, error } = await db
    .from('social_accounts')
    .update({ platform, account_name, username: username || null, url: url || null, notes: notes || null, assigned_to: assigned_to || null })
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
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { error } = await db.from('social_accounts').delete().eq('id', params.id);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
