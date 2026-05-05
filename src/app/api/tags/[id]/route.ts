import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { name, color } = await request.json();
  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (name !== undefined) { updates.push(`name = $${idx++}`); values.push(name); }
  if (color !== undefined) { updates.push(`color = $${idx++}`); values.push(color); }

  if (updates.length === 0) {
    return NextResponse.json({ message: 'Aucun champ à mettre à jour' }, { status: 400 });
  }

  values.push(params.id);
  const result = await query(
    `UPDATE tags SET ${updates.join(',')} WHERE id = $${idx} RETURNING *`,
    values
  );
  if (!result.rows[0]) return notFound('Tag introuvable');
  return NextResponse.json(result.rows[0]);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const result = await query('DELETE FROM tags WHERE id = $1 RETURNING id', [params.id]);
  if (!result.rows[0]) return notFound('Tag introuvable');
  return NextResponse.json({ message: 'Tag supprimé', id: params.id });
}
