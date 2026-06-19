import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { data } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, role, is_active, avatar_url, created_at, acquisition_sources')
    .order('created_at', { ascending: false });

  return NextResponse.json(data || []);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { email, password, first_name, last_name, role } = await request.json();

  if (!email || !password || !first_name || !last_name) {
    return NextResponse.json({ message: 'Tous les champs sont requis' }, { status: 400 });
  }
  if (password.length < 8) {
    return NextResponse.json({ message: 'Le mot de passe doit contenir au moins 8 caractères' }, { status: 400 });
  }

  const { data: existing } = await supabase.from('users').select('id').eq('email', email).single();
  if (existing) return NextResponse.json({ message: 'Email déjà utilisé' }, { status: 409 });

  const hash = await bcrypt.hash(password, 10);
  const { data } = await supabase
    .from('users')
    .insert({ email, password_hash: hash, first_name, last_name, role: role || 'setter' })
    .select('id, email, first_name, last_name, role, is_active, created_at')
    .single();

  return NextResponse.json(data, { status: 201 });
}
