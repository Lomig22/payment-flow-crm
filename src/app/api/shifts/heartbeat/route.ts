import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  await (supabase as any)
    .from('shifts')
    .update({ last_heartbeat: new Date().toISOString() })
    .eq('user_id', user.id)
    .is('ended_at', null);

  return NextResponse.json({ ok: true });
}
