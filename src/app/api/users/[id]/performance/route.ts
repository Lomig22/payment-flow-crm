import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin' && user.id !== params.id) return forbidden();

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get('period') || '30')));

  const { data } = await supabase.rpc('get_user_performance', {
    p_user_id: params.id,
    p_days: days,
  });

  return NextResponse.json(data || { stats: {}, monthly: [] });
}
