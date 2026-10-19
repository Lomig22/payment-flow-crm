import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';

// Campagnes Hermès : chiffres clés par campagne et réponses à classer (positive / négative)
export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const db = supabase as any;
  const [{ data: camps }, msgs] = await Promise.all([
    db.from('email_campaigns').select('*').order('first_sent_at', { ascending: false }),
    fetchAll<any>(() => db.from('email_campaign_messages').select('id, campaign_id, email, company, subject, sent_at, opened_at, open_count, replied_at, reply_snippet, bounced_at, sentiment').order('id')),
  ]);
  const campaigns = (camps ?? []).map((c: any) => {
    const m = msgs.filter((x) => x.campaign_id === c.id);
    const delivered = m.filter((x) => !x.bounced_at).length;
    const opened = m.filter((x) => x.opened_at).length, replied = m.filter((x) => x.replied_at).length;
    return {
      ...c,
      contacted: m.length, delivered, bounced: m.length - delivered,
      opened: c.open_tracking ? opened : null, opens_total: c.open_tracking ? m.reduce((n, x) => n + (x.open_count || 0), 0) : null,
      open_rate: c.open_tracking && delivered ? opened / delivered : null,
      replied, reply_rate: delivered ? replied / delivered : null,
      positive: m.filter((x) => x.sentiment === 'positive').length, negative: m.filter((x) => x.sentiment === 'negative').length,
    };
  });
  const replies = msgs.filter((x) => x.replied_at).sort((a, b) => String(b.replied_at).localeCompare(String(a.replied_at)));
  return NextResponse.json({ campaigns, replies });
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
