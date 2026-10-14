import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { leadForInteraction } from '@/lib/inbound';

// Feuille Inbound (admins) :
//  GET  → interactions (commentaires Instagram et Facebook, abonnements, DM), état de la captation,
//         abonnés gagnés par jour (compteur Instagram)
//  POST → { action: 'handled' | 'ignored' | 'new', ids } | { action: 'lead', id }
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const db = supabase as any;
  const [{ data: items }, { data: settings }, { data: daily }] = await Promise.all([
    db.from('inbound_interactions').select('*, leads(first_name, last_name, status)').order('occurred_at', { ascending: false, nullsFirst: false }).limit(1000),
    db.from('inbound_settings').select('account_username, keywords, auto_reply_text, ig_last_sync_at, ig_last_error, fb_last_sync_at, fb_last_error').limit(1).maybeSingle(),
    db.from('ig_account_daily').select('day, followers_total').order('day', { ascending: false }).limit(31),
  ]);
  // Abonnés gagnés par jour : écart du compteur d'un jour sur l'autre (la liste n'est pas fournie par Meta)
  const days = (daily ?? []).filter((d: any) => d.followers_total != null).reverse();
  const followers = days.slice(1).map((d: any, i: number) => ({ day: d.day, total: d.followers_total, gained: d.followers_total - days[i].followers_total }));
  return NextResponse.json({ items: items ?? [], settings, followers });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const body = await request.json().catch(() => ({}));
  if (body.action === 'lead') {
    if (!body.id) return badRequest('id requis');
    const lead = await leadForInteraction(String(body.id));
    return lead ? NextResponse.json({ lead_id: lead }) : badRequest('Lead impossible à créer (auteur inconnu)');
  }
  if (!['handled', 'ignored', 'new'].includes(body.action) || !Array.isArray(body.ids) || !body.ids.length) return badRequest('action ou ids invalides');
  await (supabase as any).from('inbound_interactions').update({ status: body.action }).in('id', body.ids);
  return NextResponse.json({ ok: true });
}
