import { createClient } from '@supabase/supabase-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDB = any;

const globalForSupa = globalThis as unknown as { supa: ReturnType<typeof createClient<AnyDB>> };

export const supabase =
  globalForSupa.supa ||
  createClient<AnyDB>(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

if (process.env.NODE_ENV !== 'production') globalForSupa.supa = supabase;
