import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeLead(l: any) {
  const u = l.users as { id?: string; first_name?: string; last_name?: string } | null;
  return {
    ...l,
    setter: u ? { id: u.id, first_name: u.first_name, last_name: u.last_name, email: '' } : null,
    users: undefined,
  };
}

const VALID_SORTS: Record<string, string> = {
  created_at: 'created_at', updated_at: 'updated_at',
  company: 'company', status: 'status', lead_quality: 'lead_quality',
};

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const setter_id = searchParams.get('setter_id');
  const status    = searchParams.get('status');
  const quality   = searchParams.get('quality');
  const search    = searchParams.get('search');
  const countOnly = searchParams.get('count_only') === 'true';
  const page      = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const rawLimit  = parseInt(searchParams.get('limit') || '20');
  const limit     = Math.min(2000, rawLimit);
  const sort      = VALID_SORTS[searchParams.get('sort') || ''] || 'created_at';
  const asc       = searchParams.get('order') === 'asc';
  const offset    = (page - 1) * limit;

  // Lightweight count-by-status endpoint (used by tab badges)
  if (countOnly) {
    let cq = supabase.from('qualiopi_leads').select('status');
    if (user.role !== 'admin') cq = cq.eq('setter_id', user.id);
    else if (setter_id)        cq = cq.eq('setter_id', setter_id);
    const { data: rows } = await (cq as any).limit(5000);
    const counts: Record<string, number> = {};
    let total_count = 0;
    for (const r of (rows ?? [])) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      total_count++;
    }
    return NextResponse.json({ counts, total_count });
  }

  let q = supabase
    .from('qualiopi_leads')
    .select('*, users!setter_id(id, first_name, last_name)', { count: 'exact' });

  if (user.role !== 'admin') q = q.eq('setter_id', user.id);
  else if (setter_id)        q = q.eq('setter_id', setter_id);
  if (status)  q = q.eq('status', status);
  if (quality) q = q.eq('lead_quality', quality);
  if (search) {
    const orParts = [
      `company.ilike.%${search}%`,
      `dirigeant.ilike.%${search}%`,
      `activite.ilike.%${search}%`,
      `email.ilike.%${search}%`,
      `city.ilike.%${search}%`,
      `phone.ilike.%${search}%`,
    ];
    // Recherche téléphone insensible au format (collé / espaces / points).
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) {
      const pairs = digits.match(/.{1,2}/g) ?? [];
      orParts.push(`phone.ilike.%${digits}%`);
      orParts.push(`phone.ilike.%${pairs.join(' ')}%`);
      orParts.push(`phone.ilike.%${pairs.join('.')}%`);
    }
    q = q.or(orParts.join(','));
  }

  q = q.order(sort, { ascending: asc }).range(offset, offset + limit - 1);

  const { data, count, error } = await q;
  if (error) return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });

  const total = count ?? 0;
  return NextResponse.json({
    data: (data || []).map(normalizeLead),
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) },
  });
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const body = await request.json();
  const { company, dirigeant, activite, phone, email, city, has_website,
          called, lead_quality, need_identified, setter_id,
          appointment_taken, appointment_honored, quote_sent, status, notes } = body;

  if (!company) {
    return NextResponse.json({ message: "Le nom de l'entreprise est requis" }, { status: 400 });
  }

  const assignedTo = user.role === 'admin' ? (setter_id || null) : user.id;

  const { data: lead, error } = await supabase
    .from('qualiopi_leads')
    .insert({
      company, dirigeant: dirigeant || null, activite: activite || null,
      phone: phone || null, email: email || null, city: city || null,
      has_website: has_website || false,
      called: called || false, lead_quality: lead_quality || null,
      need_identified: need_identified || null, setter_id: assignedTo,
      appointment_taken: appointment_taken || false, appointment_honored: appointment_honored || false,
      quote_sent: quote_sent || false, status: status || 'in_progress', notes: notes || null,
    })
    .select()
    .single();

  if (error || !lead) return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });

  await supabase.from('qualiopi_lead_history').insert({ qualiopi_lead_id: lead.id, user_id: user.id, action_note: 'Lead créé' });
  return NextResponse.json(lead, { status: 201 });
}
