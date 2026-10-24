import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';

// Emailing (Dashboard > Emailing) : chiffres globaux de tous les envois d'Hermès, par message envoyé et par jour,
// réponses à classer (positive / négative), mails bloqués par un anti-spam, réponses automatiques
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const db = supabase as any;
  const [{ data: camps }, msgs] = await Promise.all([
    db.from('email_campaigns').select('id, name, first_sent_at, open_tracking').order('first_sent_at', { ascending: false }),
    fetchAll<any>(() => db.from('email_campaign_messages')
      .select('id, campaign_id, email, company, subject, sent_at, opened_at, open_count, replied_at, reply_snippet, reply_kind, reply_gmail_id, mailbox, bounced_at, sentiment').order('id')),
  ]);
  // Période (dates de Paris, incluses) : ?from=AAAA-MM-JJ&to=AAAA-MM-JJ ; sans dates, tout l'historique.
  // Les mails sont rattachés à leur jour d'envoi (cohorte) : le taux d'un jour = ouvertures / réponses
  // des mails envoyés ce jour-là, ce qui permet de voir si l'ouverture baisse d'un envoi à l'autre.
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
  const sp = request.nextUrl.searchParams;
  const all = msgs.filter((x) => x.sent_at);
  const first = all.reduce((m, x) => (day(x.sent_at) < m ? day(x.sent_at) : m), day(new Date().toISOString()));
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('from') ?? '') ? sp.get('from')! : first;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.get('to') ?? '') ? sp.get('to')! : day(new Date().toISOString());
  const span = Math.round((Date.parse(to) - Date.parse(from)) / 86400_000) + 1;
  const shift = (d: string, n: number) => new Date(Date.parse(d) + n * 86400_000).toISOString().slice(0, 10);
  const prevFrom = shift(from, -span), prevTo = shift(from, -1);
  const inRange = (x: any, a: string, b: string) => { const d = day(x.sent_at); return d >= a && d <= b; };
  const tracked = new Set((camps ?? []).filter((c: any) => c.open_tracking).map((c: any) => c.id));

  // Chiffres d'un ensemble de mails : seules les vraies réponses comptent dans le taux de réponse ;
  // le taux d'ouverture ne porte que sur les mails partis avec le pixel de suivi
  const kpis = (m: any[]) => {
    const delivered = m.filter((x) => !x.bounced_at).length;
    const replied = m.filter((x) => x.reply_kind === 'human').length;
    const t = m.filter((x) => tracked.has(x.campaign_id)), tDelivered = t.filter((x) => !x.bounced_at).length;
    const opened = t.filter((x) => x.opened_at).length;
    return {
      contacted: m.length, delivered, bounced: m.length - delivered,
      opened: t.length ? opened : null, opens_total: t.length ? t.reduce((n, x) => n + (x.open_count || 0), 0) : null,
      open_rate: tDelivered ? opened / tDelivered : null,
      replied, reply_rate: delivered ? replied / delivered : null,
      auto: m.filter((x) => x.reply_kind === 'auto').length, antispam: m.filter((x) => x.reply_kind === 'antispam').length,
      positive: m.filter((x) => x.sentiment === 'positive').length, negative: m.filter((x) => x.sentiment === 'negative').length,
    };
  };
  const cur = all.filter((x) => inRange(x, from, to));
  const prev = all.filter((x) => inRange(x, prevFrom, prevTo));
  const days = new Map<string, any[]>();
  for (const x of cur) days.set(day(x.sent_at), [...(days.get(day(x.sent_at)) ?? []), x]);
  const pick = (kind: string) => cur.filter((x) => x.reply_kind === kind).sort((a, b) => String(b.replied_at).localeCompare(String(a.replied_at)));
  const names = new Map((camps ?? []).map((c: any) => [c.id, c.name]));
  const withName = (x: any) => ({ ...x, campaign: names.get(x.campaign_id) ?? '' });
  return NextResponse.json({
    period: { from, to, prev_from: prevFrom, prev_to: prevTo, first },
    totals: kpis(cur), previous: prev.length ? kpis(prev) : null,
    campaigns: (camps ?? []).map((c: any) => ({ ...c, ...kpis(cur.filter((x) => x.campaign_id === c.id)) })).filter((c: any) => c.contacted),
    by_day: Array.from(days.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([date, m]) => ({ date, ...kpis(m) })),
    replies: pick('human').map(withName), blocked: pick('antispam').map(withName), auto: pick('auto').map(withName),
  });
}


// Classement d'une réponse : positive, negative, ou null (annuler)
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const b = await request.json().catch(() => ({}));
  if (!b.id || ![null, 'positive', 'negative'].includes(b.sentiment)) return badRequest('Classement invalide');
  await (supabase as any).from('email_campaign_messages')
    .update({ sentiment: b.sentiment, sentiment_at: b.sentiment ? new Date().toISOString() : null }).eq('id', b.id);
  return NextResponse.json({ ok: true });
}
