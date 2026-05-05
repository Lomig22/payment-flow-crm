import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const result = await query(
    'SELECT id, email, first_name, last_name, role, is_active, avatar_url, created_at FROM users WHERE id = $1',
    [user.id]
  );
  return NextResponse.json(result.rows[0]);
}
