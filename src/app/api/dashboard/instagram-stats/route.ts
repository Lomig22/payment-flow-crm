import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const days = Math.min(365, Math.max(1, parseInt(searchParams.get('period') || '30')));
  const setterId = user.role !== 'admin' ? user.id : null;

  // Stats historiques + vision funnel (piste follow / DM à froid, stock, par compte)
  const [stats, funnel] = await Promise.all([
    supabase.rpc('get_instagram_dashboard_stats', { p_setter_id: setterId, p_days: days }),
    supabase.rpc('get_instagram_funnel_stats',    { p_setter_id: setterId, p_days: days }),
  ]);

  if (stats.error) {
    console.error('get_instagram_dashboard_stats error:', stats.error);
    return NextResponse.json({ message: 'Erreur RPC' }, { status: 500 });
  }
  if (funnel.error) console.error('get_instagram_funnel_stats error:', funnel.error);

  const data: any = stats.data ?? {};
  if (Array.isArray(data.by_setter_daily) && data.by_setter_daily.length) {
    data.by_setter_daily = await withFullActivity(data.by_setter_daily, setterId);
  }
  return NextResponse.json({ ...data, funnel: funnel.data ?? null });
}

const parisDay = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));

// Activité complète par setter et par jour (heure de Paris), en plus des étapes du funnel :
// follows envoyés et DM envoyés (journal d'envoi, par auteur du clic), follow backs
// obtenus (leads du setter), actions totales sur les leads (historique, par auteur).
async function withFullActivity(days: any[], setterId: string | null) {
  const db = supabase as any;
  const from = new Date(Date.now() - (days.length + 1) * 86_400_000).toISOString();
  const scope = (q: any, col: string) => (setterId ? q.eq(col, setterId) : q);

  const [log, backs, history, users] = await Promise.all([
    scope(db.from('instagram_dm_log').select('user_id, action, created_at').gte('created_at', from), 'user_id').limit(20000),
    scope(db.from('leads').select('setter_id, followed_back_at').eq('source', 'instagram').gte('followed_back_at', from), 'setter_id').limit(20000),
    scope(db.from('lead_history').select('user_id, created_at').gte('created_at', from).not('user_id', 'is', null), 'user_id').limit(50000),
    db.from('users').select('id, first_name, last_name'),
  ]);

  // compteurs[jour][utilisateur] = { follows, dms, follow_backs, actions }
  const counts = new Map<string, Map<string, Record<string, number>>>();
  const bump = (day: string, uid: string | null, key: string) => {
    if (!uid) return;
    if (!counts.has(day)) counts.set(day, new Map());
    const byUser = counts.get(day)!;
    const c = byUser.get(uid) ?? { follows: 0, dms: 0, follow_backs: 0, actions: 0 };
    c[key]++;
    byUser.set(uid, c);
  };
  for (const r of log.data ?? [])     bump(parisDay(r.created_at), r.user_id, r.action === 'follow' ? 'follows' : 'dms');
  for (const r of backs.data ?? [])   bump(parisDay(r.followed_back_at), r.setter_id, 'follow_backs');
  for (const r of history.data ?? []) bump(parisDay(r.created_at), r.user_id, 'actions');

  const names = new Map((users.data ?? []).map((u: any) => [u.id, `${u.first_name} ${u.last_name}`]));
  const empty = { follows: 0, dms: 0, follow_backs: 0, actions: 0 };
  return days.map((d: any) => {
    const day = String(d.date).slice(0, 10);
    const byUser = counts.get(day) ?? new Map();
    const setters = (d.setters ?? []).map((s: any) => ({ ...s, ...empty, ...(byUser.get(s.setter_id) ?? {}) }));
    // Personnes actives ce jour-là mais absentes de la liste du funnel (ex. sans pôle Instagram)
    byUser.forEach((c, uid) => {
      if (!setters.some((s: any) => s.setter_id === uid)) {
        setters.push({ setter_id: uid, name: names.get(uid) ?? 'Inconnu', m1: 0, r1: 0, r2: 0, reponse: 0, audit_envoye: 0, rdv: 0, ...empty, ...c });
      }
    });
    setters.sort((a: any, b: any) => (b.follows + b.dms + b.actions) - (a.follows + a.dms + a.actions));
    return { ...d, setters };
  });
}
