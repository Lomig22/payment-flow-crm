import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Renvoie la liste des régions distinctes présentes, pour alimenter le filtre
// « Région » du tableau des leads et du pipeline cold call.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');

  let q = supabase.from('leads').select('region').not('region', 'is', null).neq('region', '');
  if (source) q = q.eq('source', source);
  if (user.role !== 'admin') q = q.eq('setter_id', user.id);

  const { data } = await (q as any).limit(5000);
  const regions = Array.from(
    new Set((data ?? []).map((r: any) => (r.region || '').trim()).filter(Boolean))
  ).sort((a, b) => (a as string).localeCompare(b as string, 'fr'));

  return NextResponse.json(regions);
}
