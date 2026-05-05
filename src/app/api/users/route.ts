import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const result = await query(
    'SELECT id, email, first_name, last_name, role, is_active, avatar_url, created_at FROM users ORDER BY created_at DESC'
  );
  return NextResponse.json(result.rows);
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

  const existing = await query('SELECT id FROM users WHERE email = $1', [email]);
  if (existing.rows[0]) {
    return NextResponse.json({ message: 'Email déjà utilisé' }, { status: 409 });
  }

  const hash = await bcrypt.hash(password, 10);
  const result = await query(
    `INSERT INTO users (email, password_hash, first_name, last_name, role)
     VALUES ($1,$2,$3,$4,$5)
     RETURNING id, email, first_name, last_name, role, is_active, created_at`,
    [email, hash, first_name, last_name, role || 'setter']
  );

  return NextResponse.json(result.rows[0], { status: 201 });
}
