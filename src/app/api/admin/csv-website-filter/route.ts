import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { parse } from 'csv-parse/sync';

// Heuristics for detecting a "website" column across common scraper exports
// (Instant Data Scraper, Google Maps, Pages Jaunes...) which name columns
// after the page's own CSS classes rather than a clean label.
const WEBSITE_HEADER_HINTS = [
  'website', 'site web', 'site', 'siteweb', 'url', 'lien', 'web',
  'yyljef href', 'bi-denomination href', 'lien site',
];

const NO_WEBSITE_PLACEHOLDERS = new Set(['n/a', 'na', 'none', '-', '--', '—', 'aucun', 'aucune']);

function decodeContent(buffer: Buffer): string {
  const asUtf8 = buffer.toString('utf8');
  if (/Ã[©àâäèêëîïôùûüœ]|â€[™œ""]|Ã‰|Ã‡|Ã |Â·/i.test(asUtf8)) {
    try {
      return new TextDecoder('windows-1252').decode(buffer);
    } catch {
      return asUtf8;
    }
  }
  return asUtf8;
}

function detectWebsiteColumn(headers: string[]): string | null {
  const normalized = headers.map((h) => h.toLowerCase().trim());
  for (const hint of WEBSITE_HEADER_HINTS) {
    const idx = normalized.indexOf(hint);
    if (idx !== -1) return headers[idx];
  }
  for (let i = 0; i < normalized.length; i++) {
    if (normalized[i].includes('website') || normalized[i].includes('site web') || normalized[i].includes('url')) {
      return headers[i];
    }
  }
  return null;
}

function isNoWebsite(value: string): boolean {
  const v = value.trim().toLowerCase();
  return v === '' || NO_WEBSITE_PLACEHOLDERS.has(v);
}

function extractInstagramUsername(value: string): string | null {
  const m = value.match(/instagram\.com\/([^/?#]+)/i) || value.match(/instagr\.am\/([^/?#]+)/i);
  if (!m) return null;
  const username = m[1].replace(/^@/, '').trim();
  if (!username || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts'].includes(username.toLowerCase())) return null;
  return username;
}

function isInstagramUrl(value: string): boolean {
  return /instagram\.com\/|instagr\.am\//i.test(value) && extractInstagramUsername(value) !== null;
}

function categorize(value: string): 'no_website' | 'instagram' | 'website' {
  if (isNoWebsite(value)) return 'no_website';
  if (isInstagramUrl(value)) return 'instagram';
  return 'website';
}

function csvField(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function toCsv(headers: string[], rows: Record<string, string>[]): string {
  const lines = [headers.map(csvField).join(',')];
  for (const row of rows) {
    lines.push(headers.map((h) => csvField(row[h] ?? '')).join(','));
  }
  return lines.join('\r\n');
}

export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const formData = await request.formData();
  const file   = formData.get('file') as File | null;
  const column = formData.get('column') as string | null;
  const exportType = formData.get('export') as 'no_website' | 'instagram' | null;

  if (!file) return NextResponse.json({ message: 'Fichier requis' }, { status: 400 });

  const buffer = Buffer.from(await file.arrayBuffer());
  const text   = decodeContent(buffer);

  let dataRows: Record<string, string>[];
  try {
    dataRows = parse(text, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
      bom: true,
    });
  } catch (e: any) {
    return NextResponse.json({ message: `Fichier CSV invalide : ${e.message}` }, { status: 400 });
  }

  if (dataRows.length === 0) {
    return NextResponse.json({ message: 'Le fichier CSV est vide' }, { status: 400 });
  }

  const headers = Object.keys(dataRows[0]);

  // Step 1: no column chosen yet — return headers + suggestion for the UI
  if (!column) {
    return NextResponse.json({
      headers,
      suggested: detectWebsiteColumn(headers),
      total: dataRows.length,
    });
  }

  if (!headers.includes(column)) {
    return NextResponse.json({ message: `Colonne "${column}" introuvable dans le fichier` }, { status: 400 });
  }

  const buckets = { no_website: [] as Record<string, string>[], instagram: [] as Record<string, string>[], website: [] as Record<string, string>[] };
  for (const row of dataRows) {
    buckets[categorize(row[column] ?? '')].push(row);
  }

  // Step 2: column chosen, no export type yet — return counts so the UI can show both download options
  if (!exportType) {
    return NextResponse.json({
      no_website: buckets.no_website.length,
      instagram:  buckets.instagram.length,
      website:    buckets.website.length,
    });
  }

  if (exportType === 'no_website') {
    const csv = toCsv(headers, buckets.no_website);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="sans_site_web.csv"`,
      },
    });
  }

  if (exportType === 'instagram') {
    const igHeaders = [...headers, 'instagram_username'];
    const rows = buckets.instagram.map((row) => ({
      ...row,
      instagram_username: extractInstagramUsername(row[column] ?? '') ?? '',
    }));
    const csv = toCsv(igHeaders, rows);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="instagram_sourcing.csv"`,
      },
    });
  }

  return NextResponse.json({ message: 'Type d\'export invalide' }, { status: 400 });
}
