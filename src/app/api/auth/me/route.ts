import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { data } = await supabase
    .from('users')
    .select('id, email, first_name, last_name, role, is_active, avatar_url, created_at')
    .eq('id', user.id)
    .single();

  return NextResponse.json(data);
}
