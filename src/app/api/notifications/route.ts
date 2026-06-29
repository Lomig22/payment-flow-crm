import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') || '15')));

  // For setters: restrict to their own leads
  let leadIds: string[] | null = null;
  if (user.role !== 'admin') {
    const { data: userLeads } = await supabase
      .from('leads')
      .select('id')
      .eq('setter_id', user.id);
    leadIds = (userLeads ?? []).map((l: any) => l.id);
    if (leadIds.length === 0) return NextResponse.json([]);
  }

  let q = supabase
    .from('lead_history')
    .select('id, lead_id, field_changed, old_value, new_value, action_note, created_at, leads!lead_id(first_name, last_name, company)')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (leadIds) q = q.in('lead_id', leadIds);

  const { data, error } = await q;
  if (error) return NextResponse.json({ message: 'Erreur' }, { status: 500 });

  return NextResponse.json(data ?? []);
}
