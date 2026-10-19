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
      .select('id, campaign_id, email, company, subject, sent_at, opened_at, open_count, replied_at, reply_snippet, reply_kind, reply_gmail_id, bounced_at, sentiment').order('id')),
  ]);
  // Chiffres d'un ensemble de mails : seules les vraies réponses comptent dans le taux de réponse
  const kpis = (m: any[], tracked: boolean) => {
    const delivered = m.filter((x) => !x.bounced_at).length;
    const replied = m.filter((x) => x.reply_kind === 'human').length;
    const opened = m.filter((x) => x.opened_at).length;
    return {
      contacted: m.length, delivered, bounced: m.length - delivered,
      opened: tracked ? opened : null, opens_total: tracked ? m.reduce((n, x) => n + (x.open_count || 0), 0) : null,
      open_rate: tracked && delivered ? opened / delivered : null,
      replied, reply_rate: delivered ? replied / delivered : null,
      auto: m.filter((x) => x.reply_kind === 'auto').length, antispam: m.filter((x) => x.reply_kind === 'antispam').length,
      positive: m.filter((x) => x.sentiment === 'positive').length, negative: m.filter((x) => x.sentiment === 'negative').length,
    };
  };
  const tracked = (camps ?? []).filter((c: any) => c.open_tracking).map((c: any) => c.id);
  const totals = { ...kpis(msgs, false), ...(tracked.length ? (({ opened, opens_total, open_rate }) => ({ opened, opens_total, open_rate }))(kpis(msgs.filter((x) => tracked.includes(x.campaign_id)), true)) : {}) };
  const day = (iso: string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(iso));
  const days = new Map<string, { date: string; sent: number; replied: number }>();
  for (const x of msgs) {
    if (x.sent_at) { const d = days.get(day(x.sent_at)) ?? { date: day(x.sent_at), sent: 0, replied: 0 }; d.sent++; days.set(d.date, d); }
    if (x.reply_kind === 'human' && x.replied_at) { const d = days.get(day(x.replied_at)) ?? { date: day(x.replied_at), sent: 0, replied: 0 }; d.replied++; days.set(d.date, d); }
  }
  const pick = (kind: string) => msgs.filter((x) => x.reply_kind === kind).sort((a, b) => String(b.replied_at).localeCompare(String(a.replied_at)));
  const names = new Map((camps ?? []).map((c: any) => [c.id, c.name]));
  const withName = (x: any) => ({ ...x, campaign: names.get(x.campaign_id) ?? '' });
  return NextResponse.json({
    totals,
    campaigns: (camps ?? []).map((c: any) => ({ ...c, ...kpis(msgs.filter((x) => x.campaign_id === c.id), c.open_tracking) })),
    by_day: Array.from(days.values()).sort((a, b) => a.date.localeCompare(b.date)),
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
