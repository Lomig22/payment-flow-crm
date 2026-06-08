import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeLead(l: any) {
  const u = l.users as { id?: string; first_name?: string; last_name?: string } | null;
  const lt = l.lead_tags as Array<{ tags: unknown }> | null;
  return {
    ...l,
    setter: u ? { id: u.id, first_name: u.first_name, last_name: u.last_name, email: '' } : null,
    tags: (lt || []).map((t) => t.tags).filter(Boolean),
    users: undefined,
    lead_tags: undefined,
  };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { data: lead, error } = await supabase
    .from('leads')
    .select('*, users!setter_id(id, first_name, last_name), lead_tags(tags(id, name, color))')
    .eq('id', params.id)
    .single();

  if (error || !lead) return notFound('Lead introuvable');
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();

  const { data: history } = await supabase
    .from('lead_history')
    .select('*, users!user_id(first_name, last_name)')
    .eq('lead_id', params.id)
    .order('created_at', { ascending: false });

  const normalizedHistory = (history || []).map((h: Record<string, unknown>) => {
    const hu = h.users as { first_name?: string; last_name?: string } | null;
    return { ...h, first_name: hu?.first_name, last_name: hu?.last_name, users: undefined };
  });

  return NextResponse.json({ ...normalizeLead(lead), history: normalizedHistory });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { data: current, error: fetchErr } = await supabase
    .from('leads')
    .select('*')
    .eq('id', params.id)
    .single();

  if (fetchErr || !current) return notFound('Lead introuvable');
  if (user.role !== 'admin' && current.setter_id !== user.id) return forbidden();

  const body = await request.json();
  const allowed = ['first_name','last_name','company','phone','email','location','called',
    'action_in_progress','lead_quality','need_identified','appointment_taken','appointment_honored',
    'quote_sent','r2_planned','r3_planned','status','source','notes',
    // Instagram
    'instagram_username','instagram_url','a_ouvert','niche','bio','followers_count','ig_score'];
  if (user.role === 'admin') allowed.push('setter_id');

  // Date automatique pour le funnel Instagram
  const IG_STATUS_DATE: Record<string, string> = {
    m1: 'm1_date', r1: 'r1_date', r2: 'r2_date',
    reponse: 'reponse_date', a_relancer: 'a_relancer_date',
    audit_a_envoyer: 'audit_date', audit_envoye: 'audit_date', rdv: 'rdv_date',
  };

  const updates: Record<string, unknown> = {};
  const historyRows: Record<string, unknown>[] = [];

  for (const field of allowed) {
    if (body[field] !== undefined && String(body[field]) !== String(current[field])) {
      updates[field] = body[field];
      historyRows.push({
        lead_id: params.id, user_id: user.id, field_changed: field,
        old_value: String(current[field] ?? ''), new_value: String(body[field] ?? ''),
      });
    }
  }

  // Si le statut change et que c'est un lead Instagram → enregistre la date
  if (updates.status && current.source === 'instagram') {
    const dateField = IG_STATUS_DATE[updates.status as string];
    if (dateField) updates[dateField] = new Date().toISOString();
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('leads').update(updates).eq('id', params.id);
    if (historyRows.length > 0) await supabase.from('lead_history').insert(historyRows);
  }

  if (body.tags !== undefined) {
    await supabase.from('lead_tags').delete().eq('lead_id', params.id);
    if (body.tags.length > 0) {
      await supabase.from('lead_tags').insert(
        body.tags.map((tagId: string) => ({ lead_id: params.id, tag_id: tagId }))
      );
    }
  }

  const { data: updated } = await supabase.from('leads').select('*').eq('id', params.id).single();
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { data, error } = await supabase.from('leads').delete().eq('id', params.id).select('id').single();
  if (error || !data) return notFound('Lead introuvable');
  return NextResponse.json({ message: 'Lead supprimé', id: params.id });
}
