import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { data } = await supabase.from('tags').select('*').order('name');
  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { name, color } = await request.json();
  if (!name) return NextResponse.json({ message: 'Nom requis' }, { status: 400 });

  const { data } = await supabase
    .from('tags')
    .insert({ name, color: color || '#6366f1' })
    .select()
    .single();

  return NextResponse.json(data, { status: 201 });
}
