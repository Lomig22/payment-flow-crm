import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin' && user.id !== params.id) return forbidden();

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || '30';
  const days = Math.min(365, Math.max(1, parseInt(period)));

  const stats = await query(
    `SELECT
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '${days} days') AS leads_created,
       COUNT(*) FILTER (WHERE called = true AND updated_at >= NOW() - INTERVAL '${days} days') AS leads_called,
       COUNT(*) FILTER (WHERE appointment_taken = true AND updated_at >= NOW() - INTERVAL '${days} days') AS appointments_taken,
       COUNT(*) FILTER (WHERE appointment_honored = true AND updated_at >= NOW() - INTERVAL '${days} days') AS appointments_honored,
       COUNT(*) FILTER (WHERE quote_sent = true AND updated_at >= NOW() - INTERVAL '${days} days') AS quotes_sent,
       COUNT(*) FILTER (WHERE status = 'won' AND updated_at >= NOW() - INTERVAL '${days} days') AS won,
       COUNT(*) FILTER (WHERE status = 'lost' AND updated_at >= NOW() - INTERVAL '${days} days') AS lost
     FROM leads WHERE setter_id = $1`,
    [params.id]
  );

  const monthly = await query(
    `SELECT
       DATE_TRUNC('month', created_at) AS month,
       COUNT(*) AS leads_created,
       COUNT(*) FILTER (WHERE appointment_taken = true) AS appointments
     FROM leads
     WHERE setter_id = $1 AND created_at >= NOW() - INTERVAL '12 months'
     GROUP BY 1 ORDER BY 1`,
    [params.id]
  );

  return NextResponse.json({ stats: stats.rows[0], monthly: monthly.rows });
}
