import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

const FORMATS = ['reel', 'story', 'post', 'carousel'];

// Objectifs de publication par jour : { account_username, format, per_day }
export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { account_username, format, per_day } = await request.json();
  const n = Number(per_day);
  if (!account_username || !FORMATS.includes(format)) return badRequest('Compte ou format invalide');
  if (!Number.isInteger(n) || n < 0 || n > 100) return badRequest('Objectif invalide (0 à 100)');

  const { data, error } = await (supabase as any)
    .from('content_targets')
    .upsert({ account_username, format, per_day: n, updated_at: new Date().toISOString() })
    .select()
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}
