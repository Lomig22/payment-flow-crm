import CITY_REGION from './city-regions.json';

// Liste ordonnée des régions (pour d'éventuels usages UI). "Autre" = non classé.
export const REGIONS = [
  'Auvergne-Rhône-Alpes', 'Bourgogne-Franche-Comté', 'Bretagne',
  'Centre-Val de Loire', 'Grand Est', 'Hauts-de-France', 'Île-de-France',
  'Normandie', 'Nouvelle-Aquitaine', 'Occitanie', 'Pays de la Loire',
  "Provence-Alpes-Côte d'Azur", 'Luxembourg',
] as const;

// Normalise un libellé de ville pour comparaison (minuscules, sans accents ni ponctuation).
function norm(s: string): string {
  return s
    .normalize('NFD').replace(/[̀-ͯ]/g, '') // enlève les accents
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Index normalisé construit une seule fois à partir du mapping JSON.
const NORM_INDEX: Record<string, string> = {};
for (const [ville, region] of Object.entries(CITY_REGION as Record<string, string>)) {
  NORM_INDEX[norm(ville)] = region;
}

/**
 * Déduit la région française (ou "Luxembourg") à partir d'un champ `location`,
 * qu'il contienne juste une ville ("Vannes") ou une adresse complète
 * ("31 Gd Rue d'Aléry, 74960 Annecy, France"). Renvoie null si non reconnu.
 */
export function regionForLocation(location?: string | null): string | null {
  if (!location) return null;
  const raw = location.trim();
  if (!raw) return null;

  // Candidats de ville à tester, du plus probable au moins probable :
  const candidates: string[] = [];
  // 1) ville placée juste après un code postal ("… 74960 Annecy, France")
  const afterCp = raw.match(/\d{4,5}\s+([^,]+)/);
  if (afterCp) candidates.push(afterCp[1]);
  // 2) chaque segment séparé par une virgule (adresses)
  for (const part of raw.split(',')) candidates.push(part);
  // 3) la chaîne entière (cas "Vannes")
  candidates.push(raw);

  for (const c of candidates) {
    const hit = NORM_INDEX[norm(c)];
    if (hit) return hit;
  }
  return null;
}
