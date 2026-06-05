import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// GET — admin: full shift history across a date range with activity stats
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { searchParams } = new URL(request.url);
  const today = new Date().toISOString().slice(0, 10);
  const startDate = searchParams.get('start') ?? (() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  })();
  const endDate = searchParams.get('end') ?? today;

  const dayStart = `${startDate}T00:00:00+00:00`;
  const dayEnd   = `${endDate}T23:59:59+00:00`;

  const { data, error } = await (supabase as any).rpc('get_shifts_with_stats', {
    day_start: dayStart,
    day_end:   dayEnd,
  });

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}
