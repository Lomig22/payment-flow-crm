import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// GET — admin: all shifts for a given date (defaults to today)
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { searchParams } = new URL(request.url);
  const date = searchParams.get('date') ?? new Date().toISOString().slice(0, 10);

  const dayStart = `${date}T00:00:00+00:00`;
  const dayEnd   = `${date}T23:59:59+00:00`;

  // Auto-close stale open shifts: no heartbeat for > 3 minutes
  const staleThreshold = new Date(Date.now() - 3 * 60 * 1000).toISOString();
  await db
    .from('shifts')
    .update({ ended_at: staleThreshold })
    .is('ended_at', null)
    .not('last_heartbeat', 'is', null)
    .lt('last_heartbeat', staleThreshold)
    .gte('started_at', dayStart)
    .lte('started_at', dayEnd);

  const { data, error } = await db
    .from('shifts')
    .select(`
      id, started_at, ended_at, last_heartbeat,
      users!user_id ( id, first_name, last_name, email, role )
    `)
    .gte('started_at', dayStart)
    .lte('started_at', dayEnd)
    .order('started_at', { ascending: false });

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
