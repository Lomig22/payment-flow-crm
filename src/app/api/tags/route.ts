import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const result = await query('SELECT * FROM tags ORDER BY name');
  return NextResponse.json(result.rows);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { name, color } = await request.json();
  if (!name) return NextResponse.json({ message: 'Nom requis' }, { status: 400 });

  const result = await query(
    'INSERT INTO tags (name, color) VALUES ($1, $2) RETURNING *',
    [name, color || '#6366f1']
  );
  return NextResponse.json(result.rows[0], { status: 201 });
}
