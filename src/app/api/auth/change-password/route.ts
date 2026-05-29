import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthUser, unauthorized, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { old_password, new_password } = await request.json();
  if (!old_password || !new_password) return badRequest('Ancien et nouveau mot de passe requis');
  if (new_password.length < 8) return badRequest('Le nouveau mot de passe doit contenir au moins 8 caractères');

  const { data } = await supabase.from('users').select('password_hash').eq('id', user.id).single();
  const row = data as { password_hash: string } | null;
  const isValid = await bcrypt.compare(old_password, row!.password_hash);
  if (!isValid) return badRequest('Ancien mot de passe incorrect');

  const hash = await bcrypt.hash(new_password, 10);
  await supabase.from('users').update({ password_hash: hash }).eq('id', user.id);
  return NextResponse.json({ message: 'Mot de passe mis à jour' });
}
