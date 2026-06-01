import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { ids } = await request.json();
  if (!Array.isArray(ids) || ids.length === 0) return badRequest('Liste d\'IDs requise');

  const { error } = await supabase.from('leads').delete().in('id', ids);
  if (error) return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });

  return NextResponse.json({ message: `${ids.length} lead(s) supprimé(s)`, count: ids.length });
}
