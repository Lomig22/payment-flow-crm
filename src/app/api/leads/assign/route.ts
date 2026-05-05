import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { lead_ids, setter_id } = await request.json();

  if (!Array.isArray(lead_ids) || lead_ids.length === 0) {
    return NextResponse.json({ message: 'lead_ids requis' }, { status: 400 });
  }

  const placeholders = lead_ids.map((_, i) => `$${i + 2}`).join(',');
  await query(
    `UPDATE leads SET setter_id = $1, updated_at = NOW() WHERE id IN (${placeholders})`,
    [setter_id || null, ...lead_ids]
  );

  for (const leadId of lead_ids) {
    await query(
      'INSERT INTO lead_history (lead_id,user_id,field_changed,new_value,action_note) VALUES ($1,$2,$3,$4,$5)',
      [leadId, user.id, 'setter_id', setter_id || '', 'Réassignation manuelle']
    );
  }

  return NextResponse.json({ message: `${lead_ids.length} leads réassignés` });
}
