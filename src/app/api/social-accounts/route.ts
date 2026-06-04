import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const { searchParams } = new URL(request.url);
  const platform = searchParams.get('platform'); // 'instagram' | 'facebook' | null

  let query = db
    .from('social_accounts')
    .select('*, users!created_by ( id, first_name, last_name )')
    .order('platform')
    .order('account_name');

  if (platform) query = query.eq('platform', platform);

  const { data, error } = await query;
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const body = await request.json();
  const { platform, account_name, username, url, notes, assigned_to } = body;

  if (!platform || !account_name) {
    return NextResponse.json({ message: 'Plateforme et nom de compte requis' }, { status: 400 });
  }
  if (!['instagram', 'facebook'].includes(platform)) {
    return NextResponse.json({ message: 'Plateforme invalide' }, { status: 400 });
  }

  const db = supabase as any;
  const { data, error } = await db
    .from('social_accounts')
    .insert({ platform, account_name, username: username || null, url: url || null, notes: notes || null, assigned_to: assigned_to || null, created_by: user.id })
    .select()
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data, { status: 201 });
}
