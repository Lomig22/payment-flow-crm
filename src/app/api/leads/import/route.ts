import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { parse } from 'csv-parse/sync';

const COLUMN_MAP: Record<string, string> = {
  prenom: 'first_name', prénom: 'first_name', firstname: 'first_name', first_name: 'first_name', 'prénom': 'first_name',
  nom: 'last_name', lastname: 'last_name', last_name: 'last_name', surname: 'last_name',
  entreprise: 'company', company: 'company', société: 'company', societe: 'company',
  telephone: 'phone', téléphone: 'phone', phone: 'phone', tel: 'phone', mobile: 'phone',
  email: 'email', mail: 'email', 'e-mail': 'email',
  ville: 'location', location: 'location', adresse: 'location', localisation: 'location', city: 'location',
  notes: 'notes', commentaire: 'notes', commentaires: 'notes',
  qualite: 'lead_quality', qualité: 'lead_quality', lead_quality: 'lead_quality',
  statut: 'status', status: 'status',
};

const VALID_QUALITY = new Set(['hot', 'warm', 'cold']);
const VALID_STATUS  = new Set(['in_progress', 'client', 'lost']);

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const formData = await request.formData();
  const file           = formData.get('file') as File | null;
  const assignmentMode = (formData.get('assignment_mode') as string | null) ?? 'round_robin';
  const setterIdParam  = formData.get('setter_id') as string | null;

  if (!file) return NextResponse.json({ message: 'Fichier requis' }, { status: 400 });

  const text = await file.text();
  let records: Record<string, string>[];

  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    });
  } catch (e: any) {
    return NextResponse.json({ message: `Fichier CSV invalide : ${e.message}` }, { status: 400 });
  }

  if (records.length === 0) {
    return NextResponse.json({ message: 'Le fichier CSV est vide' }, { status: 400 });
  }

  // Resolve setter list for round-robin
  let setterIds: string[] = [];
  let rrIndex = 0;

  if (user.role === 'admin') {
    if (assignmentMode === 'round_robin') {
      const { data: activeSetters } = await supabase
        .from('users')
        .select('id')
        .eq('role', 'setter')
        .eq('is_active', true);
      setterIds = (activeSetters ?? []).map((s: any) => s.id);
    } else if (assignmentMode === 'manual' && setterIdParam) {
      setterIds = [setterIdParam];
    }
  } else {
    setterIds = [user.id];
  }

  const getNextSetter = (): string | null => {
    if (setterIds.length === 0) return null;
    const id = setterIds[rrIndex % setterIds.length];
    rrIndex++;
    return id;
  };

  let imported = 0;
  let skipped  = 0;
  const errors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const mapped = COLUMN_MAP[k.toLowerCase().trim()];
      if (mapped) row[mapped] = v.trim();
    }

    if (!row.first_name || !row.last_name) {
      skipped++;
      errors.push(`Ligne ${i + 2} : prénom ou nom manquant`);
      continue;
    }

    const { error } = await supabase.from('leads').insert({
      first_name:  row.first_name,
      last_name:   row.last_name,
      company:     row.company    || null,
      phone:       row.phone      || null,
      email:       row.email      || null,
      location:    row.location   || null,
      lead_quality: VALID_QUALITY.has(row.lead_quality) ? row.lead_quality : null,
      status:      VALID_STATUS.has(row.status) ? row.status : 'in_progress',
      notes:       row.notes      || null,
      setter_id:   getNextSetter(),
    });

    if (error) {
      skipped++;
      errors.push(`Ligne ${i + 2} : ${error.message}`);
    } else {
      imported++;
    }
  }

  return NextResponse.json({
    message:         `${imported} lead${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}, ${skipped} ignoré${skipped > 1 ? 's' : ''}`,
    total:           imported,
    imported,
    skipped,
    assignment_mode: assignmentMode,
    errors:          errors.slice(0, 10),
  });
}
