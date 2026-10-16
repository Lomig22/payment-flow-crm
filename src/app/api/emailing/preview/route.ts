import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { buildVars } from '@/lib/emailVars';

// Aperçu des modèles : variables d'un vrai lead du segment, pris au hasard (?segment=site|no_site)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const segment = request.nextUrl.searchParams.get('segment') === 'no_site' ? 'no_site' : 'site';
  const db = supabase as any;
  const { count } = await db.from('email_leads').select('id', { count: 'exact', head: true }).eq('segment', segment);
  if (!count) return NextResponse.json({ lead: null, variables: {} });
  const at = Math.floor(Math.random() * count);
  const { data } = await db.from('email_leads').select('*').eq('segment', segment).order('id').range(at, at);
  const l = data?.[0];
  return NextResponse.json({ lead: l ? { email: l.email, company: l.company } : null, variables: l ? buildVars(l) : {} });
}
