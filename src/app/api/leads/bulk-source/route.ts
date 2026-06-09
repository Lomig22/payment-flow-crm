import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

const VALID_SOURCES = ['instagram', 'facebook', 'cold_call'];

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { ids, source } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) return badRequest('IDs requis');
  if (!VALID_SOURCES.includes(source)) return badRequest('Source invalide');

  const { error } = await supabase.from('leads').update({ source }).in('id', ids);
  if (error) return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });

  return NextResponse.json({ updated: ids.length });
}
