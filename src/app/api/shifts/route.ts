import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// GET — admin: all shifts for a given date with activity stats
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  const dayStart = `${date}T00:00:00+00:00`;
  const dayEnd   = `${date}T23:59:59+00:00`;

  const { data, error } = await db.rpc('get_shifts_with_stats', {
    day_start: dayStart,
    day_end:   dayEnd,
  });

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
