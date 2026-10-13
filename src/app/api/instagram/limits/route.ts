import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { getStoredLimits } from '@/lib/igLimits';

// Limites d'envoi Instagram : lecture (tous) ; modification et suspension (admins)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  return NextResponse.json(await getStoredLimits());
}

// Minuit (heure de Paris) du jour suivant, en instant UTC
function tonightMidnightParis(): Date {
  const now = new Date();
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Paris', hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now).map((x) => [x.type, x.value]));
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - now.getTime();
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day + 1) - offset);
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const b = await request.json();
  const updates: Record<string, unknown> = { updated_by: user.id, updated_at: new Date().toISOString() };
  for (const k of ['dm_per_day', 'follows_per_day', 'dm_per_hour', 'dm_interval_sec'] as const) {
    if (b[k] === undefined) continue;
    const n = Number(b[k]);
    if (!Number.isInteger(n) || n < 0 || n > 10_000) return badRequest('Valeurs entières de 0 à 10 000 (0 = pas de limite)');
    updates[k] = n;
  }
  if (b.suspend === 'today') updates.suspended_until = tonightMidnightParis().toISOString();
  if (b.suspend === 'off')   updates.suspended_until = null;

  const { error } = await (supabase as any).from('instagram_limits').upsert({ id: 1, ...updates });
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(await getStoredLimits());
}
