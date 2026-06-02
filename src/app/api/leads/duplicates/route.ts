import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export interface DuplicateGroup {
  field: 'phone' | 'email';
  value: string;
  leads: { id: string; first_name: string; last_name: string }[];
}

const normPhone = (p: string) => p.replace(/[\s.\-\(\)\/]/g, '');

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  // Fetch all leads with phone or email (only fields needed for dedup)
  const { data, error } = await (supabase as any)
    .from('leads')
    .select('id, first_name, last_name, phone, email')
    .or('phone.not.is.null,email.not.is.null')
    .limit(10000);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const leads: { id: string; first_name: string; last_name: string; phone: string | null; email: string | null }[] =
    data ?? [];

  // Group by normalized phone
  const phoneMap = new Map<string, typeof leads>();
  for (const lead of leads) {
    if (!lead.phone) continue;
    const key = normPhone(lead.phone);
    if (!key) continue;
    if (!phoneMap.has(key)) phoneMap.set(key, []);
    phoneMap.get(key)!.push(lead);
  }

  // Group by lowercased email
  const emailMap = new Map<string, typeof leads>();
  for (const lead of leads) {
    if (!lead.email) continue;
    const key = lead.email.toLowerCase().trim();
    if (!key) continue;
    if (!emailMap.has(key)) emailMap.set(key, []);
    emailMap.get(key)!.push(lead);
  }

  const groups: DuplicateGroup[] = [];

  for (const [value, group] of phoneMap) {
    if (group.length > 1) {
      groups.push({
        field: 'phone',
        value: group[0].phone!,
        leads: group.map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
      });
    }
  }

  for (const [, group] of emailMap) {
    if (group.length > 1) {
      groups.push({
        field: 'email',
        value: group[0].email!,
        leads: group.map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
      });
    }
  }

  // Total individual leads involved in at least one duplicate group
  const affectedIds = new Set(groups.flatMap((g) => g.leads.map((l) => l.id)));

  return NextResponse.json({
    count:  affectedIds.size,
    groups: groups.slice(0, 50),
  });
}
