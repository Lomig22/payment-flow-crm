import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Plateformes de cross-post connectées (sans les jetons)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { data } = await (supabase as any).from('platform_tokens').select('platform, data, updated_at');
  const byPlatform = Object.fromEntries((data ?? []).map((r: any) => [r.platform, r]));
  const describe = (p: string, name: (d: any) => string | null) => {
    const r = byPlatform[p];
    return r ? { connected: r.data?.enabled !== false, name: name(r.data), since: r.updated_at } : { connected: false, name: null, since: null };
  };
  return NextResponse.json({
    facebook: describe('facebook', (d) => d.page_name ?? null),
    youtube:  describe('youtube',  (d) => d.channel_title ?? null),
    tiktok:   { ...describe('tiktok', (d) => d.display_name ?? null), can_connect: !!process.env.TIKTOK_CLIENT_KEY },
  });
}
