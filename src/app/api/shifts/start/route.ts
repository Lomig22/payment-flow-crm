import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// POST — create a new shift for the authenticated user
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  // Close any unclosed shift from today (in case of crash)
  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);

  await (supabase as any)
    .from('shifts')
    .update({ ended_at: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('ended_at', null)
    .gte('started_at', todayStart.toISOString());

  const { data, error } = await (supabase as any)
    .from('shifts')
    .insert({ user_id: user.id })
    .select('id, started_at')
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
