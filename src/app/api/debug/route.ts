import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

export async function GET() {
  try {
    const { count, error } = await supabase.from('users').select('*', { count: 'exact', head: true });
    if (error) throw error;
    return NextResponse.json({ ok: true, users: count, supabase_url: process.env.SUPABASE_URL });
  } catch (err: unknown) {
    const e = err as Error;
    return NextResponse.json({ ok: false, error: e.message });
  }
}
