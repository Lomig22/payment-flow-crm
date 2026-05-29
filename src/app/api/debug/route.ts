import { NextResponse } from 'next/server';
import { Pool } from 'pg';

async function tryConnect(label: string, url: string) {
  try {
    const pool = new Pool({
      connectionString: url,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
      max: 1,
    });
    const result = await pool.query('SELECT COUNT(*) as users FROM users');
    await pool.end();
    return { label, ok: true, users: result.rows[0].users };
  } catch (err: unknown) {
    const e = err as Error;
    return { label, ok: false, error: e.message.substring(0, 120) };
  }
}

export async function GET() {
  const pass = process.env.DB_PASS || 'Atematem1166-lol';
  const ref  = 'syjavchstzwpmknnjjif';

  const results = await Promise.all([
    // Pooler via hostname (transaction)
    tryConnect('pooler-tx-hostname', `postgresql://postgres.${ref}:${pass}@aws-0-eu-central-1.pooler.supabase.com:6543/postgres`),
    // Pooler via IP (transaction)
    tryConnect('pooler-tx-ip1', `postgresql://postgres.${ref}:${pass}@18.198.145.223:6543/postgres`),
    tryConnect('pooler-tx-ip2', `postgresql://postgres.${ref}:${pass}@52.59.152.35:6543/postgres`),
    // Pooler via IP (session port)
    tryConnect('pooler-session-ip1', `postgresql://postgres.${ref}:${pass}@18.198.145.223:5432/postgres`),
    // Direct host
    tryConnect('direct', `postgresql://postgres:${pass}@db.${ref}.supabase.co:5432/postgres`),
  ]);

  return NextResponse.json({
    jwt_set: !!process.env.JWT_SECRET,
    results,
  });
}
