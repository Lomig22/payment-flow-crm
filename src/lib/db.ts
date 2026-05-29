import { Pool } from 'pg';
import dns from 'dns';

// Force IPv4 — Vercel serverless ne supporte pas IPv6 vers Supabase
dns.setDefaultResultOrder('ipv4first');

// Singleton pool — évite les connexions multiples en hot-reload dev et serverless
const globalForPg = globalThis as unknown as { pool: Pool };

export const pool =
  globalForPg.pool ||
  new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }, // requis pour Supabase
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

if (process.env.NODE_ENV !== 'production') globalForPg.pool = pool;

export const query = (text: string, params?: unknown[]) => pool.query(text, params);
