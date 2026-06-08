import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

const IG_STATUS_DATE: Record<string, string> = {
  m1: 'm1_date', r1: 'r1_date', r2: 'r2_date',
  reponse: 'reponse_date', a_relancer: 'a_relancer_date',
  audit_a_envoyer: 'audit_date', audit_envoye: 'audit_date', rdv: 'rdv_date',
};

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const { ids, status } = body as { ids: string[]; status: string };

  if (!Array.isArray(ids) || ids.length === 0 || !status) {
    return NextResponse.json({ message: 'ids et status requis' }, { status: 400 });
  }

  const updates: Record<string, unknown> = { status };
  const dateField = IG_STATUS_DATE[status];
  if (dateField) updates[dateField] = new Date().toISOString();

  const { error } = await (supabase as any)
    .from('leads')
    .update(updates)
    .in('id', ids);

  if (error) return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });

  // Log history for each lead
  const historyRows = ids.map((lead_id) => ({
    lead_id, user_id: user.id,
    field_changed: 'status', new_value: status,
    action_note: `Statut mis à jour en masse → ${status}`,
  }));
  await (supabase as any).from('lead_history').insert(historyRows);

  return NextResponse.json({ updated: ids.length });
}
