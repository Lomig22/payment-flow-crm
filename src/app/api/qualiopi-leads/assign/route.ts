import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { lead_ids, setter_id } = await request.json();
  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return NextResponse.json({ message: 'lead_ids requis' }, { status: 400 });
  }

  await supabase.from('qualiopi_leads').update({ setter_id: setter_id || null }).in('id', lead_ids);

  const historyRows = lead_ids.map((id: string) => ({
    qualiopi_lead_id: id,
    user_id: user.id,
    field_changed: 'setter_id',
    new_value: setter_id || '',
    action_note: 'Réassignation manuelle',
  }));
  await supabase.from('qualiopi_lead_history').insert(historyRows);

  return NextResponse.json({ message: `${lead_ids.length} leads réassignés` });
}
