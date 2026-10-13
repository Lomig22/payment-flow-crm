import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { startOfTodayParis } from '@/lib/paris-time';
import { DM_VARIANT_MEMORY } from '@/lib/instagram';
import { getEffectiveLimits } from '@/lib/igLimits';

// Activité du jour par compte d'envoi : DM de prospection (jour / heure glissante /
// dernier envoi / dernières variantes utilisées), follows, et état de repos.
// « DM de prospection » = clic qui a fait avancer le lead (M1, R1, R2) ; ouvrir les
// DM d'une conversation en cours n'est pas compté.
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const db = supabase as any;
  const dayStart  = startOfTodayParis();
  const hourStart = new Date(Date.now() - 3_600_000);
  // La fenêtre d'une heure peut déborder sur la veille (juste après minuit)
  const since = new Date(Math.min(dayStart.getTime(), hourStart.getTime())).toISOString();

  const [logs, accounts] = await Promise.all([
    db.from('instagram_dm_log')
      .select('account_id, action, from_status, to_status, variant, created_at')
      .gte('created_at', since).order('created_at', { ascending: false }).limit(10000),
    db.from('social_accounts').select('id, paused_until, pause_reason').eq('platform', 'instagram'),
  ]);
  if (logs.error) return NextResponse.json({ message: logs.error.message }, { status: 500 });

  type Acc = { dm_today: number; dm_hour: number; last_dm_at: string | null; follows_today: number;
               recent_variants: string[]; paused_until: string | null; pause_reason: string | null };
  const blank = (): Acc => ({ dm_today: 0, dm_hour: 0, last_dm_at: null, follows_today: 0,
                              recent_variants: [], paused_until: null, pause_reason: null });
  const byAccount: Record<string, Acc> = {};
  const now = Date.now();
  for (const a of accounts.data ?? []) {
    const active = a.paused_until && new Date(a.paused_until).getTime() > now;
    byAccount[a.id] = { ...blank(), paused_until: active ? a.paused_until : null, pause_reason: active ? a.pause_reason : null };
  }

  for (const r of logs.data ?? []) {   // du plus récent au plus ancien
    const acc = (byAccount[r.account_id ?? 'none'] ??= blank());
    const t = new Date(r.created_at).getTime();
    if (r.action === 'follow') {
      if (t >= dayStart.getTime()) acc.follows_today++;
      continue;
    }
    if (r.from_status === r.to_status) continue;          // conversation en cours, pas un envoi
    if (t >= dayStart.getTime())  acc.dm_today++;
    if (t >= hourStart.getTime()) acc.dm_hour++;
    if (!acc.last_dm_at) acc.last_dm_at = r.created_at;
    if (r.variant && acc.recent_variants.length < DM_VARIANT_MEMORY) acc.recent_variants.push(r.variant);
  }

  // Compat : anciens champs today / follows (compteurs par compte)
  const today   = Object.fromEntries(Object.entries(byAccount).map(([k, v]) => [k, v.dm_today]));
  const follows = Object.fromEntries(Object.entries(byAccount).map(([k, v]) => [k, v.follows_today]));
  // Limites en vigueur (réglées par un admin) : l'écran bloque avant le serveur
  return NextResponse.json({ today, follows, accounts: byAccount, limits: await getEffectiveLimits() });
}
