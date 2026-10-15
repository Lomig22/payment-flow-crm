import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { accountEvent } from '@/lib/linkedin';

// Surveillance du VPS (15/10/2026 : panne chez Hostinger à 7 h 57, découverte à 12 h 50).
// Le worker LinkedIn contacte le CRM chaque minute : sans nouvelles depuis 15 min, Lomig reçoit
// un mail (une seule fois par panne), puis un autre au retour. Appelé toutes les 10 min par GitHub
// Actions (.github/workflows/vps-watchdog.yml). Sans clé : la route ne fait que lire l'état et envoie au
// plus un mail par changement d'état ; elle ne renvoie rien d'autre que « up » ou « down ».
export const dynamic = 'force-dynamic';

const SILENCE_MS = 15 * 60_000;

export async function GET(_request: NextRequest) {
  const db = supabase as any;
  const { data: s } = await db.from('linkedin_settings').select('last_seen_at').eq('id', 1).single();
  const { data: last } = await db.from('linkedin_events').select('type, created_at')
    .in('type', ['vps_down', 'vps_up']).order('created_at', { ascending: false }).limit(1);
  const seen = s?.last_seen_at ? new Date(s.last_seen_at) : null;
  const silent = !seen || Date.now() - seen.getTime() > SILENCE_MS;
  const alerted = last?.[0]?.type === 'vps_down';
  const fmt = (d: Date) => d.toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' });

  if (silent && !alerted) {
    await accountEvent('vps_down', `Worker silencieux depuis ${seen ? fmt(seen) : 'toujours'}`, { subject: 'VPS injoignable', lines: [
      `Le worker du VPS n'a plus contacté le CRM depuis ${seen ? fmt(seen) : 'longtemps'} : LinkedIn et le rendu des reels sont à l'arrêt.`,
      'Redémarrez le VPS : hpanel.hostinger.com > VPS > srv1794104 > Redémarrer. Tout repart seul au démarrage.',
    ] });
    return NextResponse.json({ state: 'down' });
  }
  if (!silent && alerted) {
    await accountEvent('vps_up', `Worker de retour (${fmt(seen!)})`, { subject: 'VPS de retour', lines: ['Le worker du VPS contacte de nouveau le CRM : LinkedIn et les reels ont repris.'] });
    return NextResponse.json({ state: 'up' });
  }
  return NextResponse.json({ state: silent ? 'down' : 'up' });
}
