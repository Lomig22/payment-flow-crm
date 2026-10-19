import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import { hasAgentKey } from '@/lib/emailingAuth';

// Remontée des campagnes envoyées directement par Hermès (script du VPS /opt/pf-cron/hermes-campaigns.py,
// toutes les 15 min) : chaque mail envoyé, sa réponse éventuelle et son rebond, lus dans la boîte Gmail.
// Clé EMAILING_AGENT_KEY. Le classement positif / négatif de Lomig n'est jamais écrasé.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  if (!hasAgentKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  const b = await request.json().catch(() => null);
  const c = b?.campaign, msgs = Array.isArray(b?.messages) ? b.messages : [];
  if (!c?.id || !c?.name) return NextResponse.json({ message: 'Campagne manquante' }, { status: 400 });
  const db = supabase as any;
  const { error: ce } = await db.from('email_campaigns').upsert({
    id: String(c.id).slice(0, 120), name: String(c.name).slice(0, 200), source: c.source ?? null,
    first_sent_at: c.first_sent_at ?? null, open_tracking: !!c.open_tracking,
  });
  if (ce) return NextResponse.json({ message: ce.message }, { status: 500 });
  const rows = msgs.filter((m: any) => m?.gmail_id && m?.email).map((m: any) => ({
    campaign_id: c.id, gmail_id: String(m.gmail_id), thread_id: m.thread_id ?? null, email: String(m.email).toLowerCase().trim(),
    company: m.company ?? null, subject: m.subject ?? null, sent_at: m.sent_at ?? null,
    replied_at: m.replied_at ?? null, reply_snippet: m.reply_snippet ? String(m.reply_snippet).slice(0, 500) : null,
    bounced_at: m.bounced_at ?? null, updated_at: new Date().toISOString(),
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await db.from('email_campaign_messages').upsert(rows.slice(i, i + 500), { onConflict: 'gmail_id' });
    if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, messages: rows.length });
}
