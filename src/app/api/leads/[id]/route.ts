import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, notFound } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const result = await query(
    `SELECT l.*, u.id AS setter_user_id, u.first_name AS setter_first_name, u.last_name AS setter_last_name,
            COALESCE(json_agg(DISTINCT jsonb_build_object('id',t.id,'name',t.name,'color',t.color))
              FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
     FROM leads l
     LEFT JOIN users u ON l.setter_id = u.id
     LEFT JOIN lead_tags lt ON l.id = lt.lead_id
     LEFT JOIN tags t ON lt.tag_id = t.id
     WHERE l.id = $1
     GROUP BY l.id, u.id, u.first_name, u.last_name`,
    [params.id]
  );

  if (!result.rows[0]) return notFound('Lead introuvable');
  const lead = result.rows[0];
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();

  const history = await query(
    `SELECT h.*, u.first_name, u.last_name FROM lead_history h
     LEFT JOIN users u ON h.user_id = u.id
     WHERE h.lead_id = $1 ORDER BY h.created_at DESC`,
    [params.id]
  );

  return NextResponse.json({ ...lead, history: history.rows });
}

export async function PUT(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const current = await query('SELECT * FROM leads WHERE id = $1', [params.id]);
  if (!current.rows[0]) return notFound('Lead introuvable');
  const lead = current.rows[0];
  if (user.role !== 'admin' && lead.setter_id !== user.id) return forbidden();

  const body = await request.json();
  const allowed = ['first_name','last_name','company','phone','email','location','called',
    'action_in_progress','lead_quality','need_identified','appointment_taken','appointment_honored',
    'quote_sent','r2_planned','r3_planned','status','notes'];
  if (user.role === 'admin') allowed.push('setter_id');

  const updates: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  for (const field of allowed) {
    if (body[field] !== undefined && String(body[field]) !== String(lead[field])) {
      updates.push(`${field} = $${idx++}`);
      values.push(body[field]);
      await query(
        'INSERT INTO lead_history (lead_id,user_id,field_changed,old_value,new_value) VALUES ($1,$2,$3,$4,$5)',
        [params.id, user.id, field, String(lead[field] ?? ''), String(body[field] ?? '')]
      );
    }
  }

  if (updates.length > 0) {
    values.push(params.id);
    await query(`UPDATE leads SET ${updates.join(',')} WHERE id = $${idx}`, values);
  }

  if (body.tags !== undefined) {
    await query('DELETE FROM lead_tags WHERE lead_id = $1', [params.id]);
    for (const tagId of body.tags || []) {
      await query('INSERT INTO lead_tags (lead_id,tag_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [params.id, tagId]);
    }
  }

  const updated = await query('SELECT * FROM leads WHERE id = $1', [params.id]);
  return NextResponse.json(updated.rows[0]);
}

export async function DELETE(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const result = await query('DELETE FROM leads WHERE id = $1 RETURNING id', [params.id]);
  if (!result.rows[0]) return notFound('Lead introuvable');
  return NextResponse.json({ message: 'Lead supprimé', id: params.id });
}
