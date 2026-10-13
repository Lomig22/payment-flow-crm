import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Met un compte d'envoi au repos (days > 0) ou le réactive (days = 0 / null).
// Un compte au repos ne peut plus servir ni aux follows ni aux DM de prospection.
export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const db = supabase as any;
  const { data: acc } = await db
    .from('social_accounts').select('id, created_by, assigned_to').eq('id', params.id).single();
  if (!acc) return NextResponse.json({ message: 'Compte introuvable' }, { status: 404 });
  const fullName = `${user.first_name} ${user.last_name}`;
  if (user.role !== 'admin' && acc.created_by !== user.id && acc.assigned_to !== fullName) return forbidden();

  const { days, reason } = await request.json().catch(() => ({}));
  const n = Number(days);
  const paused = Number.isFinite(n) && n > 0;
  const { data, error } = await db
    .from('social_accounts')
    .update({
      paused_until: paused ? new Date(Date.now() + Math.min(n, 60) * 86_400_000).toISOString() : null,
      pause_reason: paused ? (typeof reason === 'string' && reason.trim() ? reason.trim().slice(0, 200) : 'Mise au repos manuelle') : null,
    })
    .eq('id', params.id)
    .select('id, username, paused_until, pause_reason')
    .single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}
