import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const setter_id = searchParams.get('setter_id');
  const status    = searchParams.get('status');
  const quality   = searchParams.get('quality');
  const search    = searchParams.get('search');
  const page      = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const limit     = Math.min(100, parseInt(searchParams.get('limit') || '20'));
  const sort      = searchParams.get('sort') || 'created_at';
  const order     = searchParams.get('order') === 'asc' ? 'asc' : 'desc';
  const offset    = (page - 1) * limit;

  const validSorts = ['created_at', 'updated_at', 'last_name', 'status', 'lead_quality'];
  const safeSort   = validSorts.includes(sort) ? `l.${sort}` : 'l.created_at';

  const conditions: string[] = [];
  const params: unknown[]    = [];
  let idx = 1;

  if (user.role !== 'admin') {
    conditions.push(`l.setter_id = $${idx++}`); params.push(user.id);
  } else if (setter_id) {
    conditions.push(`l.setter_id = $${idx++}`); params.push(setter_id);
  }
  if (status)  { conditions.push(`l.status = $${idx++}`);       params.push(status); }
  if (quality) { conditions.push(`l.lead_quality = $${idx++}`); params.push(quality); }
  if (search) {
    conditions.push(`(l.first_name ILIKE $${idx} OR l.last_name ILIKE $${idx} OR l.company ILIKE $${idx} OR l.email ILIKE $${idx})`);
    params.push(`%${search}%`); idx++;
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const countRes = await query(`SELECT COUNT(*) FROM leads l ${where}`, params);
  const total    = parseInt(countRes.rows[0].count);

  const leadsRes = await query(
    `SELECT l.*, u.first_name AS setter_first_name, u.last_name AS setter_last_name,
            COALESCE(json_agg(json_build_object('id',t.id,'name',t.name,'color',t.color))
              FILTER (WHERE t.id IS NOT NULL), '[]') AS tags
     FROM leads l
     LEFT JOIN users u  ON l.setter_id = u.id
     LEFT JOIN lead_tags lt ON l.id = lt.lead_id
     LEFT JOIN tags t  ON lt.tag_id = t.id
     ${where}
     GROUP BY l.id, u.first_name, u.last_name
     ORDER BY ${safeSort} ${order}
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...params, limit, offset]
  );

  return NextResponse.json({
    data: leadsRes.rows,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const { first_name, last_name, company, phone, email, location,
          called, action_in_progress, lead_quality, need_identified,
          setter_id, appointment_taken, appointment_honored, quote_sent,
          r2_planned, r3_planned, status, notes } = body;

  if (!first_name || !last_name) {
    return NextResponse.json({ message: 'Prénom et nom sont requis' }, { status: 400 });
  }

  const assignedTo = user.role === 'admin' ? (setter_id || null) : user.id;

  const result = await query(
    `INSERT INTO leads (first_name,last_name,company,phone,email,location,called,action_in_progress,
      lead_quality,need_identified,setter_id,appointment_taken,appointment_honored,quote_sent,
      r2_planned,r3_planned,status,notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,
    [first_name, last_name, company||null, phone||null, email||null, location||null,
     called||false, action_in_progress||'to_call', lead_quality||null, need_identified||null,
     assignedTo, appointment_taken||false, appointment_honored||false, quote_sent||false,
     r2_planned||false, r3_planned||false, status||'in_progress', notes||null]
  );

  const lead = result.rows[0];
  await query('INSERT INTO lead_history (lead_id,user_id,action_note) VALUES ($1,$2,$3)',
    [lead.id, user.id, 'Lead créé']);

  return NextResponse.json(lead, { status: 201 });
}
