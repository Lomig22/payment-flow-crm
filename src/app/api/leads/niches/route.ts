import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Renvoie la liste des activités (niches) distinctes présentes, pour alimenter
// le filtre « Activité » du tableau des leads.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');

  let q = supabase.from('leads').select('niche').not('niche', 'is', null).neq('niche', '');
  if (source) q = q.eq('source', source);
  if (user.role !== 'admin') q = q.eq('setter_id', user.id);

  const { data } = await (q as any).limit(5000);
  const niches = Array.from(
    new Set((data ?? []).map((r: any) => (r.niche || '').trim()).filter(Boolean))
  ).sort((a, b) => (a as string).localeCompare(b as string, 'fr'));

  return NextResponse.json(niches);
}
