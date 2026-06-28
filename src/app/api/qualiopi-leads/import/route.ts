import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { parse } from 'csv-parse/sync';

// Colonnes du tableur Qualiopi (ex. « SansSite_OK ») + alias courants.
const Q_COLUMN_MAP: Record<string, string> = {
  nom_entreprise: 'company', 'nom entreprise': 'company', entreprise: 'company',
  'société': 'company', societe: 'company', company: 'company', 'raison sociale': 'company',
  activite: 'activite', 'activité': 'activite', secteur: 'activite',
  'catégorie': 'activite', categorie: 'activite', 'catégories': 'activite', categories: 'activite', activity: 'activite',
  dirigeant: 'dirigeant', gerant: 'dirigeant', 'gérant': 'dirigeant', contact: 'dirigeant', responsable: 'dirigeant',
  telephone: 'phone', 'téléphone': 'phone', phone: 'phone', tel: 'phone', 'tél': 'phone', mobile: 'phone', portable: 'phone',
  ville: 'city', city: 'city', localisation: 'city', location: 'city', commune: 'city', adresse: 'city',
  email: 'email', mail: 'email', 'e-mail': 'email',
  site: '_website', website: '_website', 'site web': '_website', site_web: '_website', url: '_website',
  notes: 'notes', commentaire: 'notes', commentaires: 'notes', description: 'notes',
  statut: 'status', status: 'status',
};

const VALID_STATUS = new Set([
  'in_progress', 'client', 'lost', 'to_follow_up', 'to_follow_up_2', 'appointment', 'r2',
]);

// Détecte du Windows-1252 lu comme de l'UTF-8 (fréquent sur les fichiers scrapés)
function decodeContent(buffer: Buffer): string {
  const asUtf8 = buffer.toString('utf8');
  if (/Ã[©àâäèêëîïôùûüœ]|â€[™œ""]|Ã‰|Ã‡|Ã |Â·/i.test(asUtf8)) {
    try { return new TextDecoder('windows-1252').decode(buffer); } catch { return asUtf8; }
  }
  return asUtf8;
}

function cleanPhone(raw: string): string {
  return raw
    .replace(/.*[Tt](?:él|el)\s*:\s*/i, '')
    .replace(/^[\s·•\-–,]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const formData = await request.formData();
  const file            = formData.get('file') as File | null;
  let   assignmentMode  = (formData.get('assignment_mode') as string | null) ?? 'round_robin';
  const setterIdParam   = formData.get('setter_id') as string | null;
  const setterIdsParam  = formData.get('setter_ids') as string | null;
  const selectedSetterIds = setterIdsParam ? setterIdsParam.split(',').filter(Boolean) : [];
  const dryRun          = (formData.get('dry_run') as string | null) === 'true';
  const skipDuplicates  = (formData.get('skip_duplicates') as string | null) === 'true';

  if (!file) return NextResponse.json({ message: 'Fichier requis' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const text   = decodeContent(buffer);

  let records: Record<string, string>[];
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
  } catch (e: any) {
    return NextResponse.json({ message: `Fichier CSV invalide : ${e.message}` }, { status: 400 });
  }
  if (records.length === 0) {
    return NextResponse.json({ message: 'Le fichier CSV est vide' }, { status: 400 });
  }

  // Résolution de la liste des setters (round-robin / manuel / soi-même)
  let setterIds: string[] = [];
  let rrIndex = 0;
  if (user.role === 'admin') {
    if (assignmentMode === 'round_robin') {
      if (selectedSetterIds.length > 0) {
        setterIds = selectedSetterIds;
      } else {
        const { data: activeSetters } = await supabase
          .from('users').select('id').eq('role', 'setter').eq('is_active', true);
        setterIds = (activeSetters ?? []).map((s: any) => s.id);
      }
    } else if (assignmentMode === 'manual' && setterIdParam) {
      setterIds = [setterIdParam];
    }
  } else {
    setterIds = [user.id];
    assignmentMode = 'self';
  }
  const getNextSetter = (): string | null => {
    if (setterIds.length === 0) return null;
    const id = setterIds[rrIndex % setterIds.length];
    rrIndex++;
    return id;
  };

  // ── Pass 1 : parse ────────────────────────────────────────────────────────
  type ParsedRow = Record<string, string>;
  const parsedRows: ParsedRow[] = [];
  const parseErrors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    if (Object.values(raw).every((v) => !v || !v.trim())) continue;

    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw)) {
      const key = k.toLowerCase().trim().replace(/^﻿/, '');
      const mapped = Q_COLUMN_MAP[key];
      if (!mapped) continue;
      if (mapped === '_website') {
        if (v && v.trim()) row.has_website = 'true';
      } else if (mapped === 'dirigeant') {
        // Retire les mentions entre parenthèses : "JEAN DUPONT (Gérant)" → "JEAN DUPONT"
        const name = v.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
        if (name) row.dirigeant = name;
      } else {
        if (v && v.trim()) row[mapped] = v.trim();
      }
    }

    if (row.phone) row.phone = cleanPhone(row.phone);
    if (row.company) row.company = row.company.slice(0, 255);

    if (!row.company) {
      parseErrors.push(`Ligne ${i + 2} : nom d'entreprise manquant`);
      continue;
    }
    parsedRows.push({ ...row, _lineNum: String(i + 2) });
  }

  // ── Pass 2 : détection de doublons (téléphone) ────────────────────────────
  const normPhone = (p: string) => p.replace(/[\s.\-\(\)\/]/g, '');
  const csvPhones = parsedRows.map((r) => r.phone).filter(Boolean).map(normPhone);

  const dbPhoneSet = new Set<string>();
  const dbPhoneLabel: Record<string, string> = {};
  if (csvPhones.length > 0) {
    const { data: existing } = await (supabase as any)
      .from('qualiopi_leads')
      .select('company, phone')
      .in('phone', csvPhones);
    for (const lead of existing ?? []) {
      if (lead.phone) { const np = normPhone(lead.phone); dbPhoneSet.add(np); dbPhoneLabel[np] = lead.company; }
    }
  }
  const seenPhones = new Set<string>();

  // ── Pass 3 : insertion ────────────────────────────────────────────────────
  let imported = 0;
  let skipped  = 0;
  const errors:     string[] = [...parseErrors];
  const duplicates: string[] = [];

  for (const row of parsedRows) {
    const lineNum = Number(row._lineNum);
    const label   = row.company;
    let isDuplicateRow = false;

    if (row.phone) {
      const np = normPhone(row.phone);
      if (dbPhoneSet.has(np)) {
        duplicates.push(`Ligne ${lineNum} (${label}) : téléphone ${row.phone} déjà présent — ${dbPhoneLabel[np]}`);
        isDuplicateRow = true;
      } else if (seenPhones.has(np)) {
        duplicates.push(`Ligne ${lineNum} (${label}) : téléphone ${row.phone} en doublon dans ce fichier`);
        isDuplicateRow = true;
      }
      seenPhones.add(np);
    }

    if (dryRun) continue;
    if (skipDuplicates && isDuplicateRow) { skipped++; continue; }

    const { error } = await (supabase as any).from('qualiopi_leads').insert({
      company:     row.company,
      dirigeant:   row.dirigeant || null,
      activite:    row.activite  || null,
      phone:       row.phone     || null,
      email:       row.email     || null,
      city:        row.city      || null,
      has_website: row.has_website === 'true',
      status:      VALID_STATUS.has(row.status) ? row.status : 'in_progress',
      notes:       row.notes     || null,
      setter_id:   getNextSetter(),
    });

    if (error) { skipped++; errors.push(`Ligne ${lineNum} : ${error.message}`); }
    else imported++;
  }

  if (dryRun) {
    return NextResponse.json({
      dry_run:         true,
      total:           parsedRows.length,
      duplicate_count: duplicates.length,
      errors:          errors.slice(0, 10),
      duplicates:      duplicates.slice(0, 20),
    });
  }

  return NextResponse.json({
    message:         `${imported} lead${imported > 1 ? 's' : ''} importé${imported > 1 ? 's' : ''}, ${skipped} ignoré${skipped > 1 ? 's' : ''}`,
    total:           imported,
    imported,
    skipped,
    duplicate_count: duplicates.length,
    assignment_mode: assignmentMode,
    errors:          errors.slice(0, 10),
    duplicates:      duplicates.slice(0, 20),
  });
}
