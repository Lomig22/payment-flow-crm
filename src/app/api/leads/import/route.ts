import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { parse } from 'csv-parse/sync';

const COLUMN_MAP: Record<string, string> = {
  prenom: 'first_name', prénom: 'first_name', firstname: 'first_name', first_name: 'first_name',
  nom: 'last_name', lastname: 'last_name', last_name: 'last_name',
  entreprise: 'company', company: 'company', société: 'company',
  telephone: 'phone', téléphone: 'phone', phone: 'phone', tel: 'phone',
  email: 'email', mail: 'email',
  ville: 'location', location: 'location', adresse: 'location',
  notes: 'notes', commentaire: 'notes', commentaires: 'notes',
  qualite: 'lead_quality', qualité: 'lead_quality', lead_quality: 'lead_quality',
  statut: 'status', status: 'status',
};

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const formData = await request.formData();
  const file = formData.get('file') as File | null;
  const setterIdParam = formData.get('setter_id') as string | null;

  if (!file) return NextResponse.json({ message: 'Fichier requis' }, { status: 400 });

  const text = await file.text();
  let records: Record<string, string>[];

  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return NextResponse.json({ message: 'Fichier CSV invalide' }, { status: 400 });
  }

  let imported = 0;
  let skipped = 0;
  const assignedTo = user.role === 'admin' ? (setterIdParam || null) : user.id;

  for (const raw of records) {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const mapped = COLUMN_MAP[k.toLowerCase().trim()];
      if (mapped) row[mapped] = v;
    }
    if (!row.first_name || !row.last_name) { skipped++; continue; }

    const { data: lead } = await supabase
      .from('leads')
      .insert({
        first_name: row.first_name, last_name: row.last_name,
        company: row.company || null, phone: row.phone || null,
        email: row.email || null, location: row.location || null,
        lead_quality: row.lead_quality || null,
        status: row.status || 'in_progress',
        notes: row.notes || null, setter_id: assignedTo,
      })
      .select('id')
      .single();

    if (lead) {
      await supabase.from('lead_history').insert({ lead_id: lead.id, user_id: user.id, action_note: 'Lead importé via CSV' });
      imported++;
    } else {
      skipped++;
    }
  }

  return NextResponse.json({ message: `${imported} leads importés, ${skipped} ignorés`, imported, skipped });
}
