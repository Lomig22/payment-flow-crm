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
  // Apify Instagram Profile Scraper
  full_name: 'company',
  biography: '_ig_bio',
  username: '_ig_username',
  profile_url: '_ig_url',
  source_hashtag: '_ig_hashtag',
  score: '_ig_score',
  business_category: '_ig_biz_cat',
  followers_count: '_ignore',
  following_count: '_ignore',
  is_verified: '_ignore',
  posts_count: '_ignore',
  scraped_at: '_ignore',
  'score_breakdown/0': '_ignore',
  'score_breakdown/1': '_ignore',
  'score_breakdown/2': '_ignore',
  'score_breakdown/3': '_ignore',
  'score_breakdown/4': '_ignore',
  'score_breakdown/5': '_ignore',
  'score_breakdown/6': '_ignore',
  'score_breakdown/7': '_ignore',
};

const VALID_QUALITY = new Set(['hot', 'warm', 'cold']);
const VALID_STATUS  = new Set(['in_progress', 'client', 'lost', 'to_follow_up', 'to_follow_up_2', 'appointment', 'r2']);

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
  const setterIdsParam = formData.get('setter_ids') as string | null;
  const selectedSetterIds = setterIdsParam ? setterIdsParam.split(',').filter(Boolean) : [];
  const VALID_SOURCE   = new Set(['instagram', 'facebook', 'cold_call']);
  const rawSource      = formData.get('source') as string | null;
  const leadSource     = rawSource && VALID_SOURCE.has(rawSource) ? rawSource : null;

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

  // ── Pass 1 : parse all records into structured rows ──────────────────────
  type ParsedRow = Record<string, string>;
  const parsedRows: ParsedRow[] = [];
  const parseErrors: string[] = [];

  for (let i = 0; i < records.length; i++) {
    const raw = records[i];
    const row: Record<string, string> = {};
    const extras: string[] = [];

    for (const [k, v] of Object.entries(raw)) {
      const key    = k.toLowerCase().trim().replace(/^﻿/, '');
      const mapped = effectiveMap[key];
      if (!mapped || mapped === '_ignore') continue;

      if (mapped === '_desc') {
        const loc = extractLocation(v);
        if (loc && !row.location) row.location = loc;
        if (v) extras.push(v.trim());
      } else if (mapped === '_website') {
        if (v) extras.push(`Site : ${v.trim()}`);
      } else if (mapped === '_pj_desc') {
        const desc = v.trim();
        if (desc) extras.push(desc.length > 400 ? desc.slice(0, 400) + '…' : desc);
      } else if (mapped === '_pj_url') {
        if (v && v.includes('/pros/')) extras.push(`Pages Jaunes : ${v.trim()}`);
      } else if (mapped === '_dirigeant') {
        const name = v.replace(/\(.*?\)/g, '').replace(/\s+/g, ' ').trim();
        if (name) row._dirigeant = name;
      } else if (mapped === '_categories') {
        const cats = v.trim();
        if (cats) extras.push(cats.replace(/\|/g, ', '));
      } else if (mapped === '_ig_bio') {
        if (v) extras.push(v.trim().replace(/[\n\r]+/g, ' ').slice(0, 400));
      } else if (mapped === '_ig_username') {
        if (v) row._ig_username = v.trim();
      } else if (mapped === '_ig_url') {
        if (v) extras.push(`Instagram : ${v.trim()}`);
      } else if (mapped === '_ig_hashtag') {
        if (v) extras.push(`#${v.trim()}`);
      } else if (mapped === '_ig_score') {
        const n = parseInt(v, 10);
        if (!isNaN(n)) row._ig_score = String(n);
      } else if (mapped === '_ig_biz_cat') {
        if (v && v !== 'None') extras.push(v.trim());
      } else {
        row[mapped] = v.trim();
      }
    }

    if (row._dirigeant && !row.first_name) {
      const words = row._dirigeant.split(/\s+/);
      row.first_name = words[0];
      if (!row.last_name) row.last_name = words.slice(1).join(' ') || '—';
    }
    delete row._dirigeant;

    // Apify Instagram: score → lead_quality
    if (row._ig_score !== undefined) {
      const n = parseInt(row._ig_score, 10);
      if (!isNaN(n) && !row.lead_quality) {
        row.lead_quality = n >= 15 ? 'hot' : n >= 8 ? 'warm' : 'cold';
      }
      delete row._ig_score;
    }
    // Apify Instagram: @username en tête des notes + fallback société si full_name vide
    if (row._ig_username) {
      if (!row.company) row.company = row._ig_username;
      extras.unshift(`@${row._ig_username}`);
      delete row._ig_username;
    }

    if (row.phone) row.phone = cleanPhone(row.phone);

    if (!row.first_name && !row.last_name && row.company) {
      const words = row.company.trim().split(/\s+/);
      row.first_name = words[0] ?? row.company;
      row.last_name  = words.slice(1).join(' ') || '—';
    }

    if (row.first_name) row.first_name = row.first_name.slice(0, 99);
    if (row.last_name)  row.last_name  = row.last_name.slice(0, 99);

    if (!row.first_name || !row.last_name) {
      parseErrors.push(`Ligne ${i + 2} : prénom ou nom manquant (et aucune société trouvée)`);
      continue;
    }

    if (extras.length > 0) {
      row.notes = [row.notes, ...extras].filter(Boolean).join(' | ');
    }

    parsedRows.push({ ...row, _lineNum: String(i + 2) });
  }

  // ── Pass 2 : bulk duplicate detection ────────────────────────────────────
  // Normalize phone for comparison (digits only, no spaces/dashes)
  const normPhone = (p: string) => p.replace(/[\s.\-\(\)\/]/g, '');

  // Collect phones and emails present in this CSV
  const csvPhones  = parsedRows.map(r => r.phone).filter(Boolean).map(normPhone);
  const csvEmails  = parsedRows.map(r => r.email).filter(Boolean).map(e => e.toLowerCase());

  // Sets of values already in DB
  const dbPhoneSet = new Set<string>();
  const dbEmailSet = new Set<string>();
  // Map value → "Prénom Nom" for display in warning message
  const dbPhoneLabel: Record<string, string> = {};
  const dbEmailLabel: Record<string, string> = {};

  if (csvPhones.length > 0 || csvEmails.length > 0) {
    const db = supabase as any;
    const orParts: string[] = [];
    if (csvPhones.length > 0) orParts.push(`phone.in.(${csvPhones.join(',')})`);
    if (csvEmails.length > 0) orParts.push(`email.in.(${csvEmails.join(',')})`);

    const { data: existing } = await db
      .from('leads')
      .select('first_name, last_name, phone, email')
      .or(orParts.join(','));

    for (const lead of existing ?? []) {
      const label = `${lead.first_name} ${lead.last_name}`.trim();
      if (lead.phone) { const np = normPhone(lead.phone); dbPhoneSet.add(np); dbPhoneLabel[np] = label; }
      if (lead.email) { const ne = lead.email.toLowerCase(); dbEmailSet.add(ne); dbEmailLabel[ne] = label; }
    }
  }

  // Track intra-CSV duplicates (same phone/email appears twice in the file)
  const seenPhones = new Set<string>();
  const seenEmails = new Set<string>();

  // ── Pass 3 : insert with duplicate tagging ────────────────────────────────
  let imported = 0;
  let skipped  = 0;
  const errors:     string[] = [...parseErrors];
  const duplicates: string[] = [];

  for (const row of parsedRows) {
    const lineNum = Number(row._lineNum);
    const label   = `${row.first_name} ${row.last_name}`.trim();

    // Check phone duplicates
    if (row.phone) {
      const np = normPhone(row.phone);
      if (dbPhoneSet.has(np)) {
        duplicates.push(`Ligne ${lineNum} (${label}) : téléphone ${row.phone} déjà présent — ${dbPhoneLabel[np]}`);
      } else if (seenPhones.has(np)) {
        duplicates.push(`Ligne ${lineNum} (${label}) : téléphone ${row.phone} en doublon dans ce fichier`);
      }
      seenPhones.add(np);
    }

    // Check email duplicates
    if (row.email) {
      const ne = row.email.toLowerCase();
      if (dbEmailSet.has(ne)) {
        duplicates.push(`Ligne ${lineNum} (${label}) : email ${row.email} déjà présent — ${dbEmailLabel[ne]}`);
      } else if (seenEmails.has(ne)) {
        duplicates.push(`Ligne ${lineNum} (${label}) : email ${row.email} en doublon dans ce fichier`);
      }
      seenEmails.add(ne);
    }

    const { error } = await (supabase as any).from('leads').insert({
      first_name:   row.first_name,
      last_name:    row.last_name,
      company:      row.company    || null,
      phone:        row.phone      || null,
      email:        row.email      || null,
      location:     row.location   || null,
      lead_quality: VALID_QUALITY.has(row.lead_quality) ? row.lead_quality : null,
      status:       VALID_STATUS.has(row.status) ? row.status : 'in_progress',
      source:       leadSource,
      notes:        row.notes      || null,
      setter_id:    getNextSetter(),
    });

    if (error) {
      skipped++;
      errors.push(`Ligne ${lineNum} : ${error.message}`);
    } else {
      imported++;
    }
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
