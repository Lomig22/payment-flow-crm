import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { parse } from 'csv-parse/sync';

const COLUMN_MAP: Record<string, string> = {
  // Standard French/English
  prenom: 'first_name', 'prénom': 'first_name', firstname: 'first_name', first_name: 'first_name',
  nom: 'last_name', lastname: 'last_name', last_name: 'last_name', surname: 'last_name',
  entreprise: 'company', company: 'company', 'société': 'company', societe: 'company', nom_entreprise: 'company',
  telephone: 'phone', 'téléphone': 'phone', phone: 'phone', tel: 'phone', mobile: 'phone', portable: 'phone',
  email: 'email', mail: 'email', 'e-mail': 'email',
  ville: 'location', location: 'location', adresse: 'location', localisation: 'location', city: 'location',
  notes: 'notes', commentaire: 'notes', commentaires: 'notes', description: 'notes',
  'prises de notes': 'notes',
  qualite: 'lead_quality', 'qualité': 'lead_quality', lead_quality: 'lead_quality',
  statut: 'status', status: 'status',
  // Google Maps scraper column IDs
  osrxxb: 'company',
  'rllt__details 3': 'phone',
  'rllt__details 2': '_desc',
  'yylJEf href': '_website',
  'yylJEf href 2': '_ignore',
  // Pages Jaunes (Data Scrapper)
  'truncate-2-lines': 'company',
  'number-contact': 'phone',
  matched: 'location',
  'bi-description': '_pj_desc',
  'bi-denomination href': '_pj_url',
  // Prospects export (prospects_export_*.csv)
  dirigeant: '_dirigeant',
  'catégories': '_categories',
  categories: '_categories',
  'code postal': '_ignore',
  siret: '_ignore',
  'statut clé': '_ignore',
  'statut cle': '_ignore',
  rappel: '_ignore',
  'dernier contact': '_ignore',
  'créé le': '_ignore',
  'cree le': '_ignore',
  'nombre avis': '_ignore',
  note: '_ignore',
};

const VALID_QUALITY = new Set(['hot', 'warm', 'cold']);
const VALID_STATUS  = new Set(['in_progress', 'client', 'lost']);

// Detect and fix Windows-1252 bytes misread as UTF-8 (common with scraped files)
function decodeContent(buffer: Buffer): string {
  const asUtf8 = buffer.toString('utf8');
  // Mojibake patterns: Ã© = é, Â· = ·, â€™ = '
  if (/Ã[©àâäèêëîïôùûüœ]|â€[™œ""]|Ã‰|Ã‡|Ã |Â·/i.test(asUtf8)) {
    try {
      return new TextDecoder('windows-1252').decode(buffer);
    } catch {
      return asUtf8;
    }
  }
  return asUtf8;
}

// Strip prefixes from phone numbers
// Handles Pages Jaunes format ("Tél :    04 81 68 19 96") and Google Maps bullets ("· 06…")
function cleanPhone(raw: string): string {
  return raw
    .replace(/.*[Tt](?:él|el)\s*:\s*/i, '') // "Tél :" / "Tel :" prefix (Pages Jaunes)
    .replace(/^[\s·•\-–,]+/, '')             // bullet prefix (Google Maps)
    .replace(/\s+/g, ' ')
    .trim();
}

// "Plus de 15 ans en activité · Bordeaux" → "Bordeaux"
function extractLocation(desc: string): string {
  const parts = desc.replace(/Â·|·/g, '·').split('·');
  if (parts.length >= 2) return parts[parts.length - 1].trim();
  return '';
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const formData = await request.formData();
  const file           = formData.get('file') as File | null;
  let assignmentMode = (formData.get('assignment_mode') as string | null) ?? 'round_robin';
  const setterIdParam  = formData.get('setter_id') as string | null;

  if (!file) return NextResponse.json({ message: 'Fichier requis' }, { status: 400 });

  // Read raw bytes for encoding detection
  const buffer = Buffer.from(await file.arrayBuffer());
  const text   = decodeContent(buffer);

  let records: Record<string, string>[];
  try {
    records = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });
  } catch (e: any) {
    return NextResponse.json({ message: `Fichier CSV invalide : ${e.message}` }, { status: 400 });
  }

  if (records.length === 0) {
    return NextResponse.json({ message: 'Le fichier CSV est vide' }, { status: 400 });
  }

  // Detect "prospects export" format: has a "dirigeant" column → Nom = company, not last name
  const firstRecordHeaders = Object.keys(records[0] || {}).map(h =>
    h.toLowerCase().trim().replace(/^﻿/, '')
  );
  const isProspectsExport = firstRecordHeaders.includes('dirigeant');
  const effectiveMap: Record<string, string> = isProspectsExport
    ? { ...COLUMN_MAP, nom: 'company' }
    : COLUMN_MAP;

  // Resolve setter list
  let setterIds: string[] = [];
  let rrIndex = 0;

  if (user.role === 'admin') {
    if (assignmentMode === 'round_robin') {
      const { data: activeSetters } = await supabase
        .from('users').select('id').eq('role', 'setter').eq('is_active', true);
      setterIds = (activeSetters ?? []).map((s: any) => s.id);
    } else if (assignmentMode === 'manual' && setterIdParam) {
      setterIds = [setterIdParam];
    }
  } else {
    // Setter imports are always assigned to themselves
    setterIds = [user.id];
    assignmentMode = 'self';
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
    const extras: string[] = [];

    for (const [k, v] of Object.entries(raw)) {
      const key    = k.toLowerCase().trim().replace(/^﻿/, ''); // strip BOM from first column
      const mapped = effectiveMap[key];
      if (!mapped || mapped === '_ignore') continue;

      if (mapped === '_desc') {
        // Extract location from "Plus de X ans · [City]"
        const loc = extractLocation(v);
        if (loc && !row.location) row.location = loc;
        if (v) extras.push(v.trim());
      } else if (mapped === '_website') {
        if (v) extras.push(`Site : ${v.trim()}`);
      } else if (mapped === '_pj_desc') {
        // Pages Jaunes description → truncate to avoid bloat
        const desc = v.trim();
        if (desc) extras.push(desc.length > 400 ? desc.slice(0, 400) + '…' : desc);
      } else if (mapped === '_pj_url') {
        // Only store direct business profile URLs (not search results pages)
        if (v && v.includes('/pros/')) extras.push(`Pages Jaunes : ${v.trim()}`);
      } else if (mapped === '_dirigeant') {
        // "JOSHUA MARK BAKER" or "ALEXIS SEVIN (SEVIN)" → strip parenthetical, split into name
        const name = v.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
        if (name) row._dirigeant = name;
      } else if (mapped === '_categories') {
        // "Maçon|Couvreur|Peintre" → add as readable note
        const cats = v.trim();
        if (cats) extras.push(cats.replace(/\|/g, ', '));
      } else {
        row[mapped] = v.trim();
      }
    }

    // Parse dirigeant → first_name / last_name (only if no name yet)
    if (row._dirigeant && !row.first_name) {
      const words = row._dirigeant.split(/\s+/);
      row.first_name = words[0];
      if (!row.last_name) row.last_name = words.slice(1).join(' ') || '—';
    }
    delete row._dirigeant;

    // Clean phone number
    if (row.phone) row.phone = cleanPhone(row.phone);

    // If no personal name but company exists, derive first/last from company
    if (!row.first_name && !row.last_name && row.company) {
      const words = row.company.trim().split(/\s+/);
      row.first_name = words[0] ?? row.company;
      row.last_name  = words.slice(1).join(' ') || '—';
    }

    // Truncate to DB VARCHAR(100) limits
    if (row.first_name) row.first_name = row.first_name.slice(0, 99);
    if (row.last_name)  row.last_name  = row.last_name.slice(0, 99);

    if (!row.first_name || !row.last_name) {
      skipped++;
      errors.push(`Ligne ${i + 2} : prénom ou nom manquant (et aucune société trouvée)`);
      continue;
    }

    // Append website/extra info to notes
    if (extras.length > 0) {
      row.notes = [row.notes, ...extras].filter(Boolean).join(' | ');
    }

    const { error } = await supabase.from('leads').insert({
      first_name:   row.first_name,
      last_name:    row.last_name,
      company:      row.company    || null,
      phone:        row.phone      || null,
      email:        row.email      || null,
      location:     row.location   || null,
      lead_quality: VALID_QUALITY.has(row.lead_quality) ? row.lead_quality : null,
      status:       VALID_STATUS.has(row.status) ? row.status : 'in_progress',
      notes:        row.notes      || null,
      setter_id:    getNextSetter(),
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
