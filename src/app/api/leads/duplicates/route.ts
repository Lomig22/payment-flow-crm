import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

export interface DuplicateGroup {
  field: 'phone' | 'email' | 'instagram_username';
  value: string;
  leads: { id: string; first_name: string; last_name: string }[];
}

const normPhone = (p: string) => p.replace(/[\s.\-\(\)\/]/g, '');

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const source = searchParams.get('source');

  let q = (supabase as any)
    .from('leads')
    .select('id, first_name, last_name, phone, email, instagram_username');

  if (source) {
    q = q.eq('source', source);
  } else {
    q = q.or('phone.not.is.null,email.not.is.null,instagram_username.not.is.null');
  }

  const { data, error } = await q.limit(10000);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  const leads: {
    id: string; first_name: string; last_name: string;
    phone: string | null; email: string | null; instagram_username: string | null;
  }[] = data ?? [];

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

  // Group by instagram_username
  const igMap = new Map<string, typeof leads>();
  for (const lead of leads) {
    if (!lead.instagram_username) continue;
    const key = lead.instagram_username.toLowerCase().trim();
    if (!key) continue;
    if (!igMap.has(key)) igMap.set(key, []);
    igMap.get(key)!.push(lead);
  }

  const groups: DuplicateGroup[] = [];

  Array.from(phoneMap.values()).forEach((group) => {
    if (group.length > 1) groups.push({
      field: 'phone',
      value: group[0].phone!,
      leads: group.map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
    });
  });

  Array.from(emailMap.values()).forEach((group) => {
    if (group.length > 1) groups.push({
      field: 'email',
      value: group[0].email!,
      leads: group.map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
    });
  });

  Array.from(igMap.values()).forEach((group) => {
    if (group.length > 1) groups.push({
      field: 'instagram_username',
      value: group[0].instagram_username!,
      leads: group.map(({ id, first_name, last_name }) => ({ id, first_name, last_name })),
    });
  });

  const affectedIds = new Set(groups.flatMap((g) => g.leads.map((l) => l.id)));

  return NextResponse.json({
    count:  affectedIds.size,
    groups: groups.slice(0, 50),
  });
}
