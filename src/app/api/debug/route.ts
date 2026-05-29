import { NextResponse } from 'next/server';
import { Pool } from 'pg';

export async function GET() {
  const dbUrl = process.env.DATABASE_URL;
  const jwtSecret = process.env.JWT_SECRET;

  if (!dbUrl) return NextResponse.json({ error: 'DATABASE_URL manquante' });

  try {
    const pool = new Pool({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 8000,
    });
    const result = await pool.query('SELECT COUNT(*) as users FROM users');
    await pool.end();
    return NextResponse.json({
      ok: true,
      users: result.rows[0].users,
      jwt_set: !!jwtSecret,
      db_url_prefix: dbUrl.substring(0, 50) + '...',
    });
  } catch (err: unknown) {
    const error = err as Error;
    return NextResponse.json({
      ok: false,
      error: error.message,
      db_url_prefix: dbUrl.substring(0, 50) + '...',
      jwt_set: !!jwtSecret,
    });
  }
}
