import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// POST — end a shift (by id or latest open shift for user)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const body = await request.json().catch(() => ({}));
  const shiftId = body?.shift_id as string | undefined;

  let query = (supabase as any)
    .from('shifts')
    .update({ ended_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('ended_at', null);

  if (shiftId) query = query.eq('id', shiftId);

  const { data, error } = await query.select('id, started_at, ended_at').single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}
