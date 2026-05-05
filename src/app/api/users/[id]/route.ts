import { NextRequest, NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin' && user.id !== params.id) return forbidden();

  const result = await query(
    'SELECT id, email, first_name, last_name, role, is_active, avatar_url, created_at FROM users WHERE id = $1',
    [params.id]
  );
  if (!result.rows[0]) return notFound('Utilisateur introuvable');
  return NextResponse.json(result.rows[0]);
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin' && user.id !== params.id) return forbidden();

  const body = await request.json();
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const adminFields = ['role', 'is_active'];
  const selfFields = ['first_name', 'last_name', 'avatar_url'];
  const allowed = user.role === 'admin' ? [...selfFields, ...adminFields] : selfFields;

  for (const field of allowed) {
    if (body[field] !== undefined) {
      updates.push(`${field} = $${idx++}`);
      values.push(body[field]);
    }
  }

  if (body.password && (user.role === 'admin' || user.id === params.id)) {
    if (body.password.length >= 8) {
      const hash = await bcrypt.hash(body.password, 10);
      updates.push(`password_hash = $${idx++}`);
      values.push(hash);
    }
  }

  if (updates.length === 0) {
    return NextResponse.json({ message: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  values.push(params.id);
  const result = await query(
    `UPDATE users SET ${updates.join(',')} WHERE id = $${idx} RETURNING id, email, first_name, last_name, role, is_active, avatar_url`,
    values
  );
  if (!result.rows[0]) return notFound('Utilisateur introuvable');
  return NextResponse.json(result.rows[0]);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  if (user.id === params.id) {
    return NextResponse.json({ message: 'Impossible de supprimer votre propre compte' }, { status: 400 });
  }

  const result = await query('DELETE FROM users WHERE id = $1 RETURNING id', [params.id]);
  if (!result.rows[0]) return notFound('Utilisateur introuvable');
  return NextResponse.json({ message: 'Utilisateur supprimé', id: params.id });
}
