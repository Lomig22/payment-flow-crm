import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get('period') || '30')));
  const setterId = user.role !== 'admin' ? user.id : null;

  const { data, error } = await supabase.rpc('get_instagram_dashboard_stats', {
    p_setter_id: setterId,
    p_days: days,
  });

  if (error) {
    console.error('get_instagram_dashboard_stats error:', error);
    return NextResponse.json({ message: 'Erreur RPC' }, { status: 500 });
  }

  return NextResponse.json(data ?? {});
}
