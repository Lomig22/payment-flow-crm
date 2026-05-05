import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthUser, unauthorized, badRequest } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { old_password, new_password } = await request.json();
  if (!old_password || !new_password) return badRequest('Ancien et nouveau mot de passe requis');
  if (new_password.length < 8) return badRequest('Le nouveau mot de passe doit contenir au moins 8 caractères');

  const result  = await query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  const isValid = await bcrypt.compare(old_password, result.rows[0].password_hash);
  if (!isValid) return badRequest('Ancien mot de passe incorrect');

  const hash = await bcrypt.hash(new_password, 10);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [hash, user.id]);
  return NextResponse.json({ message: 'Mot de passe mis à jour' });
}
