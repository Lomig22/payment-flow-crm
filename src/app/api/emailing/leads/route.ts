import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { importEmailCsv } from '@/lib/emailing';

// Leads emailing : liste filtrable (GET) et import d'un fichier CSV (POST { csv, file_name })
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const p = request.nextUrl.searchParams;
  const page = Math.max(1, Number(p.get('page')) || 1), size = 50;
  let q = (supabase as any).from('email_leads')
    .select('id, email, first_name, last_name, company, sector, city, status, step, last_sent_at, next_send_at, replied_at, mailbox', { count: 'exact' });
  if (p.get('status')) q = q.eq('status', p.get('status'));
  const search = p.get('q')?.trim().replace(/[%,()]/g, ' ');
  if (search) q = q.or(`email.ilike.%${search}%,company.ilike.%${search}%,first_name.ilike.%${search}%,last_name.ilike.%${search}%`);
  const { data, count, error } = await q.order('updated_at', { ascending: false }).range((page - 1) * size, page * size - 1);
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json({ leads: data ?? [], total: count ?? 0, page, size });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  const { csv, file_name } = await request.json().catch(() => ({}));
  if (typeof csv !== 'string' || !csv.trim()) return badRequest('Fichier CSV vide');
  try {
    return NextResponse.json(await importEmailCsv(csv, String(file_name ?? 'import.csv').slice(0, 200)));
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: 400 });
  }
}
