import { parse } from 'csv-parse/sync';
import { linkedinSlug, linkedinProfileUrl, capitalizeName, SECTORS } from '@/lib/linkedin';
import { normCompany } from '@/lib/linkedinFlow';
import { regionForLocation, DEPT_REGION } from '@/lib/regions';

// Import des leads sourcés par Hermès : lecture du CSV, contrôles et dédoublonnage (logique pure,
// testée par scripts/tests/linkedin-import.test.ts ; l'écriture en base est dans /api/linkedin/import).
// Ligne rejetée (avec motif) si prénom, entreprise ou URL LinkedIn manque, si l'URL n'est pas une
// URL de profil, ou si c'est un doublon : même URL LinkedIn, même SIREN ou même entreprise + ville,
// dans le fichier ou déjà dans le CRM (leads « ne plus contacter » compris). Un seul lead par entreprise.

export const PROFILE_URL = /^https?:\/\/([a-z]{2,3}\.)?(www\.)?linkedin\.com\/in\/[^/?#\s]+\/?([?#].*)?$/i;
const flat = (s: string | null | undefined) => (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const col = (h: string) => flat(h).replace(/ /g, '_');

export interface Existing { id: string; company: string | null; location: string | null; siren: string | null; linkedin_url: string | null; do_not_contact: boolean }

export interface ImportAnalysis {
  rows:     number;
  toInsert: Record<string, unknown>[];
  rejected: { line: number; name: string; reason: string }[];
  warnings: { line: number; name: string; warning: string }[];
}

// CSV → lignes (en-têtes normalisés : « Prénom » → « prenom »). Lève une erreur lisible si invalide.
export function parseHermesCsv(csv: string): Record<string, string>[] {
  const rows: Record<string, string>[] = parse(csv, { columns: (h: string[]) => h.map(col), skip_empty_lines: true, trim: true, relax_column_count: true, bom: true });
  if (!rows.length) throw new Error('Aucune ligne dans le fichier');
  if (!('linkedin' in rows[0]) || !('prenom' in rows[0]) || !('entreprise' in rows[0])) {
    throw new Error('En-tête inattendu : colonnes prenom, entreprise et linkedin requises');
  }
  return rows;
}

export function analyzeImport(rows: Record<string, string>[], crm: Existing[]): ImportAnalysis {
  // Index du CRM : URL LinkedIn, SIREN, entreprise (+ ville)
  const bySlug = new Map<string, Existing>(), bySiren = new Map<string, Existing>(), byCompany = new Map<string, Existing[]>();
  for (const l of crm) {
    const slug = linkedinSlug(l.linkedin_url);
    if (slug) bySlug.set(slug, l);
    if (l.siren) bySiren.set(l.siren, l);
    const k = normCompany(l.company);
    if (k) byCompany.set(k, [...(byCompany.get(k) ?? []), l]);
  }
  const inCrm = (company: string, city: string): Existing | undefined =>
    (byCompany.get(normCompany(company)) ?? []).find((l) => !city || !l.location || flat(l.location).includes(flat(city)));

  const rejected: { line: number; name: string; reason: string }[] = [];
  const warnings: { line: number; name: string; warning: string }[] = [];
  const seenSlug = new Map<string, number>(), seenSiren = new Map<string, number>(), seenCompany = new Map<string, number>();
  const toInsert: Record<string, unknown>[] = [];

  rows.forEach((r, i) => {
    const line = i + 2;
    const prenom = (r.prenom ?? '').trim(), entreprise = (r.entreprise ?? '').trim(), url = (r.linkedin ?? '').trim();
    const ville = (r.ville ?? '').trim();
    const name = `${prenom} ${r.nom ?? ''}`.trim() + (entreprise ? ` (${entreprise})` : '');
    const reject = (reason: string) => rejected.push({ line, name: name || '—', reason });

    if (!prenom) return reject('prénom manquant');
    if (!entreprise) return reject('entreprise manquante');
    if (!url) return reject('URL LinkedIn manquante');
    if (!PROFILE_URL.test(url)) return reject(`URL LinkedIn invalide (${url.slice(0, 80)})`);
    const slug = linkedinSlug(url)!;
    const sirenDigits = (r.siren ?? '').replace(/\D/g, '');
    const siren = sirenDigits.length === 9 ? sirenDigits : null;
    if (sirenDigits && !siren) warnings.push({ line, name, warning: `SIREN ignoré (${r.siren}) : 9 chiffres attendus` });
    const companyKey = `${normCompany(entreprise)}|${flat(ville)}`;

    // Doublons dans le fichier
    const dupLine = seenSlug.get(slug) ?? (siren ? seenSiren.get(siren) : undefined) ?? seenCompany.get(companyKey);
    if (dupLine) return reject(`doublon de la ligne ${dupLine} (même URL, SIREN ou entreprise + ville)`);

    // Déjà dans le CRM
    const known = bySlug.get(slug) ?? (siren ? bySiren.get(siren) : undefined) ?? inCrm(entreprise, ville);
    if (known) return reject(known.do_not_contact ? 'entreprise marquée « ne plus contacter »' : 'déjà présent dans le CRM (même URL, SIREN ou entreprise + ville)');

    seenSlug.set(slug, line); if (siren) seenSiren.set(siren, line); seenCompany.set(companyKey, line);

    const secteur = (r.secteur ?? '').trim().toLowerCase();
    if (secteur && !SECTORS[secteur]) warnings.push({ line, name, warning: `secteur inconnu « ${r.secteur} » (laissé vide)` });
    const dep = (r.departement ?? '').replace(/\D/g, '').padStart(2, '0').slice(0, 2);
    toInsert.push({
      first_name: capitalizeName(prenom), last_name: (r.nom ?? '').trim() || null, company: entreprise,
      job_title: (r.poste ?? '').trim() || null, li_sector: SECTORS[secteur] ? secteur : null,
      location: ville || null, region: regionForLocation(ville) || DEPT_REGION[dep] || null,
      website: (r.site_web ?? '').trim() || null, linkedin_url: linkedinProfileUrl(url), siren,
      source: 'linkedin', origin: 'outbound',
      li_import: { source: (r.source ?? '').trim() || null, date_sourcing: (r.date_sourcing ?? '').trim() || null, departement: (r.departement ?? '').trim() || null },
    });
  });

  return { rows: rows.length, toInsert, rejected, warnings };
}
