import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { query } from '@/lib/db';
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

  if (!file) {
    return NextResponse.json({ message: 'Fichier requis' }, { status: 400 });
  }

  const text = await file.text();
  let records: Record<string, string>[];

  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true });
  } catch {
    return NextResponse.json({ message: 'Fichier CSV invalide' }, { status: 400 });
  }

  let imported = 0;
  let skipped = 0;

  for (const raw of records) {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const mapped = COLUMN_MAP[k.toLowerCase().trim()];
      if (mapped) row[mapped] = v;
    }

    if (!row.first_name || !row.last_name) { skipped++; continue; }

    const assignedTo = user.role === 'admin' ? (setterIdParam || null) : user.id;

    const result = await query(
      `INSERT INTO leads (first_name,last_name,company,phone,email,location,lead_quality,status,notes,setter_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [row.first_name, row.last_name, row.company||null, row.phone||null, row.email||null,
       row.location||null, row.lead_quality||null, row.status||'in_progress', row.notes||null, assignedTo]
    );

    await query('INSERT INTO lead_history (lead_id,user_id,action_note) VALUES ($1,$2,$3)',
      [result.rows[0].id, user.id, 'Lead importé via CSV']);

    imported++;
  }

  return NextResponse.json({ message: `${imported} leads importés, ${skipped} ignorés`, imported, skipped });
}
