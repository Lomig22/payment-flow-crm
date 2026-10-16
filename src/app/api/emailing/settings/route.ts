import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Réglages de l'emailing : interrupteur, objectif du jour, séquence, plage d'envoi, consignes
export const dynamic = 'force-dynamic';

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const b = await request.json().catch(() => ({}));
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof b.active === 'boolean') patch.active = b.active;
  if (b.daily_goal != null) {
    const n = Number(b.daily_goal);
    if (!Number.isInteger(n) || n < 0 || n > 5000) return badRequest('Objectif entre 0 et 5 000');
    patch.daily_goal = n;
  }
  if (Array.isArray(b.steps)) {
    if (!b.steps.length || b.steps.length > 6) return badRequest('1 à 6 mails dans la séquence');
    patch.steps = b.steps.map((s: any, i: number) => ({
      step: i + 1, delay_days: Math.max(0, Math.min(60, Number(s.delay_days) || 0)),
      subject: String(s.subject ?? '').slice(0, 200), body: String(s.body ?? '').slice(0, 5000),
    }));
  }
  // Parcours par segment : { site: [...], no_site: [...] }, 1 à 6 mails chacun
  if (b.sequences && typeof b.sequences === 'object') {
    const seqs: Record<string, unknown> = {};
    for (const seg of ['site', 'no_site']) {
      const list = b.sequences[seg];
      if (!Array.isArray(list) || !list.length || list.length > 6) return badRequest(`Parcours ${seg === 'site' ? 'avec site' : 'sans site'} : 1 à 6 mails`);
      seqs[seg] = list.map((x: any, i: number) => ({
        step: i + 1, delay_days: i === 0 ? 0 : Math.max(1, Math.min(60, Number(x.delay_days) || 1)),
        subject: String(x.subject ?? '').slice(0, 200), body: String(x.body ?? '').slice(0, 5000),
      }));
    }
    patch.sequences = seqs;
  }
  if (Array.isArray(b.send_days)) patch.send_days = b.send_days.map(Number).filter((d: number) => d >= 1 && d <= 7);
  if (b.send_from != null) patch.send_from = Math.max(0, Math.min(23, Number(b.send_from) || 0));
  if (b.send_to != null) patch.send_to = Math.max(1, Math.min(24, Number(b.send_to) || 24));
  if (typeof b.instructions === 'string') patch.instructions = b.instructions.slice(0, 8000);
  const { data, error } = await (supabase as any).from('email_settings').update(patch).eq('id', 1).select('*').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}
