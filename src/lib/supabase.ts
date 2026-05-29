import { createClient } from '@supabase/supabase-js';

const globalForSupa = globalThis as unknown as { supa: ReturnType<typeof createClient> };

export const supabase =
  globalForSupa.supa ||
  createClient(
    process.env.SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );

if (process.env.NODE_ENV !== 'production') globalForSupa.supa = supabase;
