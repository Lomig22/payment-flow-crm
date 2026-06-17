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

  const NO_WEBSITE_PLACEHOLDERS = new Set(['n/a', 'na', 'none', '-', '--', '—', 'aucun', 'aucune']);
  const filtered = dataRows.filter((row) => {
    const v = (row[column] ?? '').trim().toLowerCase();
    return v === '' || NO_WEBSITE_PLACEHOLDERS.has(v);
  });
  const csv = toCsv(headers, filtered);

  return new NextResponse(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="sans_site_web.csv"`,
    },
  });
}
