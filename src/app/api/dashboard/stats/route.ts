import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { query } from '@/lib/db';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const period = searchParams.get('period') || '30';
  const days = Math.min(365, Math.max(1, parseInt(period)));

  const setterFilter = user.role !== 'admin' ? `AND setter_id = '${user.id}'` : '';

  const overview = await query(
    `SELECT
       COUNT(*) AS total_leads,
       COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '${days} days') AS new_leads,
       COUNT(*) FILTER (WHERE called = true) AS called,
       COUNT(*) FILTER (WHERE appointment_taken = true) AS appointments_taken,
       COUNT(*) FILTER (WHERE appointment_honored = true) AS appointments_honored,
       COUNT(*) FILTER (WHERE quote_sent = true) AS quotes_sent,
       COUNT(*) FILTER (WHERE status = 'won') AS won,
       COUNT(*) FILTER (WHERE status = 'lost') AS lost,
       COUNT(*) FILTER (WHERE status = 'in_progress') AS in_progress
     FROM leads WHERE 1=1 ${setterFilter}`
  );

  const byStatus = await query(
    `SELECT status, COUNT(*) AS count FROM leads WHERE 1=1 ${setterFilter} GROUP BY status`
  );

  const byQuality = await query(
    `SELECT lead_quality, COUNT(*) AS count FROM leads WHERE lead_quality IS NOT NULL ${setterFilter} GROUP BY lead_quality`
  );

  const trend = await query(
    `SELECT
       DATE_TRUNC('day', created_at)::date AS date,
       COUNT(*) AS count
     FROM leads
     WHERE created_at >= NOW() - INTERVAL '${days} days' ${setterFilter}
     GROUP BY 1 ORDER BY 1`
  );

  return NextResponse.json({
    overview: overview.rows[0],
    byStatus: byStatus.rows,
    byQuality: byQuality.rows,
    trend: trend.rows,
  });
}
