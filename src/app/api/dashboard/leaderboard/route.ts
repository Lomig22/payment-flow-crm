import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || '30';
  const days = Math.min(365, Math.max(1, parseInt(period)));

  const result = await query(
    `SELECT
       u.id, u.first_name, u.last_name, u.avatar_url,
       COUNT(l.id) AS total_leads,
       COUNT(l.id) FILTER (WHERE l.created_at >= NOW() - INTERVAL '${days} days') AS new_leads,
       COUNT(l.id) FILTER (WHERE l.called = true) AS called,
       COUNT(l.id) FILTER (WHERE l.appointment_taken = true) AS appointments_taken,
       COUNT(l.id) FILTER (WHERE l.appointment_honored = true) AS appointments_honored,
       COUNT(l.id) FILTER (WHERE l.status = 'won') AS won,
       COUNT(l.id) FILTER (WHERE l.status = 'lost') AS lost,
       ROUND(
         CASE WHEN COUNT(l.id) FILTER (WHERE l.called = true) > 0
           THEN COUNT(l.id) FILTER (WHERE l.appointment_taken = true)::numeric
                / COUNT(l.id) FILTER (WHERE l.called = true) * 100
           ELSE 0 END, 1
       ) AS conversion_rate
     FROM users u
     LEFT JOIN leads l ON l.setter_id = u.id
     WHERE u.role = 'setter' AND u.is_active = true
     GROUP BY u.id, u.first_name, u.last_name, u.avatar_url
     ORDER BY won DESC, appointments_taken DESC`
  );

  return NextResponse.json(result.rows);
}
