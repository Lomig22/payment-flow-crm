import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function normalizeLead(l: any) {
  const u = l.users as { id?: string; first_name?: string; last_name?: string } | null;
  const lt = l.lead_tags as Array<{ tags: unknown }> | null;
  return {
    ...l,
    setter: u ? { id: u.id, first_name: u.first_name, last_name: u.last_name, email: '' } : null,
    tags: (lt || []).map((t) => t.tags).filter(Boolean),
    users: undefined,
    lead_tags: undefined,
  };
}

const VALID_SORTS: Record<string, string> = {
  created_at: 'created_at', updated_at: 'updated_at',
  last_name: 'last_name', status: 'status', lead_quality: 'lead_quality',
};

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { searchParams } = new URL(request.url);
  const setter_id   = searchParams.get('setter_id');
  const status      = searchParams.get('status');
  const quality     = searchParams.get('quality');
  const source      = searchParams.get('source');
  const search      = searchParams.get('search');
  const niche       = searchParams.get('niche');
  const region      = searchParams.get('region');
  const a_ouvert    = searchParams.get('a_ouvert');
  const ig_username = searchParams.get('instagram_username');
  const countOnly   = searchParams.get('count_only') === 'true';
  const page        = Math.max(1, parseInt(searchParams.get('page') || '1'));
  const rawLimit    = parseInt(searchParams.get('limit') || '20');
  const limit       = Math.min(2000, rawLimit);
  const sort        = VALID_SORTS[searchParams.get('sort') || ''] || 'created_at';
  const asc         = searchParams.get('order') === 'asc';
  const offset      = (page - 1) * limit;

  // Lightweight count-by-status endpoint (used by tab badges)
  if (countOnly) {
    let cq = supabase.from('leads').select('status, a_ouvert');
    if (user.role !== 'admin') {
      cq = cq.eq('setter_id', user.id);
      if (user.acquisition_sources?.length) cq = (cq as any).in('source', user.acquisition_sources);
    } else if (setter_id) {
      cq = cq.eq('setter_id', setter_id);
    }
    if (source) cq = cq.eq('source', source);
    if (niche)  cq = (cq as any).eq('niche', niche);
    if (region) cq = (cq as any).eq('region', region);
    const { data: rows } = await (cq as any).limit(5000);
    const counts: Record<string, number> = {};
    let open_count = 0;
    let total_count = 0;
    for (const r of (rows ?? [])) {
      counts[r.status] = (counts[r.status] ?? 0) + 1;
      total_count++;
      if (r.a_ouvert) open_count++;
    }
    return NextResponse.json({ counts, open_count, total_count });
  }

  let q = supabase
    .from('leads')
    .select('*, users!setter_id(id, first_name, last_name), lead_tags(tags(id, name, color))', { count: 'exact' });

  if (user.role !== 'admin') {
    q = q.eq('setter_id', user.id);
    if (user.acquisition_sources?.length) q = (q as any).in('source', user.acquisition_sources);
  } else if (setter_id) {
    q = q.eq('setter_id', setter_id);
  }
  if (status)      q = q.eq('status', status);
  if (quality)     q = q.eq('lead_quality', quality);
  if (source)      q = q.eq('source', source);
  if (niche)       q = (q as any).eq('niche', niche);
  if (region)      q = (q as any).eq('region', region);
  if (a_ouvert === 'true')  q = (q as any).eq('a_ouvert', true);
  if (a_ouvert === 'false') q = (q as any).eq('a_ouvert', false);
  if (ig_username) q = (q as any).ilike('instagram_username', `%${ig_username.replace(/^@/, '')}%`);
  if (search) {
    const orParts = [
      `first_name.ilike.%${search}%`,
      `last_name.ilike.%${search}%`,
      `company.ilike.%${search}%`,
      `email.ilike.%${search}%`,
      `phone.ilike.%${search}%`,
      `instagram_username.ilike.%${search}%`,
    ];
    // Recherche par téléphone insensible au format : les numéros sont stockés
    // tantôt collés, tantôt séparés par des espaces ou des points. On part des
    // chiffres saisis et on teste les variantes de format les plus courantes.
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) {
      const pairs = digits.match(/.{1,2}/g) ?? [];
      orParts.push(`phone.ilike.%${digits}%`);          // collé : 0660294491
      orParts.push(`phone.ilike.%${pairs.join(' ')}%`); // espaces : 06 60 29 44 91
      orParts.push(`phone.ilike.%${pairs.join('.')}%`); // points : 06.60.29.44.91
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
  const { first_name, last_name, company, phone, email, location,
          called, action_in_progress, lead_quality, need_identified,
          setter_id, appointment_taken, appointment_honored, quote_sent,
          r2_planned, r3_planned, status, source, notes } = body;

  if (!first_name || !last_name) {
    return NextResponse.json({ message: 'Prénom et nom sont requis' }, { status: 400 });
  }

  const assignedTo = user.role === 'admin' ? (setter_id || null) : user.id;

  const { data: lead, error } = await supabase
    .from('leads')
    .insert({
      first_name, last_name, company: company || null, phone: phone || null,
      email: email || null, location: location || null,
      called: called || false, action_in_progress: action_in_progress || 'to_call',
      lead_quality: lead_quality || null, need_identified: need_identified || null,
      setter_id: assignedTo, appointment_taken: appointment_taken || false,
      appointment_honored: appointment_honored || false, quote_sent: quote_sent || false,
      r2_planned: r2_planned || false, r3_planned: r3_planned || false,
      status: status || 'in_progress', source: source || null, notes: notes || null,
    })
    .select()
    .single();

  if (error || !lead) return NextResponse.json({ message: 'Erreur serveur' }, { status: 500 });

  await supabase.from('lead_history').insert({ lead_id: lead.id, user_id: user.id, action_note: 'Lead créé' });
  return NextResponse.json(lead, { status: 201 });
}
