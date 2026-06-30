import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeLead(l: any) {
  const u = l.users as { id?: string; first_name?: string; last_name?: string } | null;
  return {
    ...l,
    setter: u ? { id: u.id, first_name: u.first_name, last_name: u.last_name, email: '' } : null,
    users: undefined,
  };
}

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { data: lead, error } = await supabase
    .from('qualiopi_leads')
    .select('*, users!setter_id(id, first_name, last_name)')
    .eq('id', params.id)
    .single();

  if (error || !lead) return notFound('Lead introuvable');
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();

  const { data: history } = await supabase
    .from('qualiopi_lead_history')
    .select('*, users!user_id(first_name, last_name)')
    .eq('qualiopi_lead_id', params.id)
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
    .from('qualiopi_leads')
    .select('*')
    .eq('id', params.id)
    .single();

  if (fetchErr || !current) return notFound('Lead introuvable');
  if (user.role !== 'admin' && current.setter_id !== user.id) return forbidden();

  const body = await request.json();
  const allowed = ['company','dirigeant','activite','phone','email','city','has_website','called',
    'lead_quality','need_identified','appointment_taken','appointment_honored','quote_sent','status','notes'];
  if (user.role === 'admin') allowed.push('setter_id');

  const updates: Record<string, unknown> = {};
  const historyRows: Record<string, unknown>[] = [];

  for (const field of allowed) {
    if (body[field] !== undefined && String(body[field]) !== String(current[field])) {
      updates[field] = body[field];
      historyRows.push({
        qualiopi_lead_id: params.id, user_id: user.id, field_changed: field,
        old_value: String(current[field] ?? ''), new_value: String(body[field] ?? ''),
      });
    }
  }

  // Cocher « RDV pris » fait avancer le lead dans la colonne « RDV pris » du
  // pipeline (organise par statut), sans jamais rétrograder un lead plus avance.
  const appointmentChecked = updates.appointment_taken === true || updates.appointment_taken === 'true';
  if (appointmentChecked) {
    const effectiveStatus = (updates.status as string) ?? current.status;
    if (['in_progress', 'to_follow_up', 'to_follow_up_2'].includes(effectiveStatus)) {
      updates.status = 'appointment';
      historyRows.push({
        qualiopi_lead_id: params.id, user_id: user.id, field_changed: 'status',
        old_value: effectiveStatus, new_value: 'appointment',
      });
    }
  }

  if (Object.keys(updates).length > 0) {
    await supabase.from('qualiopi_leads').update(updates).eq('id', params.id);
    if (historyRows.length > 0) await supabase.from('qualiopi_lead_history').insert(historyRows);
  }

  const { data: updated } = await supabase.from('qualiopi_leads').select('*').eq('id', params.id).single();
  return NextResponse.json(updated);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { data, error } = await supabase.from('qualiopi_leads').delete().eq('id', params.id).select('id').single();
  if (error || !data) return notFound('Lead introuvable');
  return NextResponse.json({ message: 'Lead supprimé', id: params.id });
}
