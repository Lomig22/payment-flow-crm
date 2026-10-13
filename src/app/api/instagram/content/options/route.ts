import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Contenus récents (60 jours) pour le champ « Contenu d'origine » d'un lead inbound.
// Ouvert aux setters : ils renseignent l'origine des leads qu'ils traitent.
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const since = new Date(Date.now() - 60 * 86_400_000).toISOString();
  const { data, error } = await (supabase as any)
    .from('ig_content')
    .select('id, format, caption, published_at, views')
    .in('format', ['reel', 'post', 'carousel'])
    .gte('published_at', since)
    .order('published_at', { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  return NextResponse.json((data ?? []).map((c: any) => ({
    id:           c.id,
    format:       c.format,
    published_at: c.published_at,
    views:        c.views,
    label:        (c.caption ?? '').split('\n')[0].slice(0, 70) || 'Sans légende',
  })));
}
