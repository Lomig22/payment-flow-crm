import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function PATCH(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const { ids, status } = body as { ids: string[]; status: string };

  if (!Array.isArray(ids) || ids.length === 0 || !status) {
    return NextResponse.json({ message: 'ids et status requis' }, { status: 400 });
  }

  const { error } = await (supabase as any)
    .from('qualiopi_leads')
    .update({ status })
    .in('id', ids);

  if (error) return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });

  const historyRows = ids.map((qualiopi_lead_id) => ({
    qualiopi_lead_id, user_id: user.id,
    field_changed: 'status', new_value: status,
    action_note: `Statut mis à jour en masse → ${status}`,
  }));
  await (supabase as any).from('qualiopi_lead_history').insert(historyRows);

  return NextResponse.json({ updated: ids.length });
}
