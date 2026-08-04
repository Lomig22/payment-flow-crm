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

// Département (2 premiers chiffres du code postal) → région. Fallback quand la
// ville n'est pas dans le mapping mais que l'adresse porte un code postal.
const DEPT_REGION: Record<string, string> = {
  '01': 'Auvergne-Rhône-Alpes', '03': 'Auvergne-Rhône-Alpes', '07': 'Auvergne-Rhône-Alpes',
  '15': 'Auvergne-Rhône-Alpes', '26': 'Auvergne-Rhône-Alpes', '38': 'Auvergne-Rhône-Alpes',
  '42': 'Auvergne-Rhône-Alpes', '43': 'Auvergne-Rhône-Alpes', '63': 'Auvergne-Rhône-Alpes',
  '69': 'Auvergne-Rhône-Alpes', '73': 'Auvergne-Rhône-Alpes', '74': 'Auvergne-Rhône-Alpes',
  '21': 'Bourgogne-Franche-Comté', '25': 'Bourgogne-Franche-Comté', '39': 'Bourgogne-Franche-Comté',
  '58': 'Bourgogne-Franche-Comté', '70': 'Bourgogne-Franche-Comté', '71': 'Bourgogne-Franche-Comté',
  '89': 'Bourgogne-Franche-Comté', '90': 'Bourgogne-Franche-Comté',
  '22': 'Bretagne', '29': 'Bretagne', '35': 'Bretagne', '56': 'Bretagne',
  '18': 'Centre-Val de Loire', '28': 'Centre-Val de Loire', '36': 'Centre-Val de Loire',
  '37': 'Centre-Val de Loire', '41': 'Centre-Val de Loire', '45': 'Centre-Val de Loire',
  '2a': 'Corse', '2b': 'Corse', '20': 'Corse',
  '08': 'Grand Est', '10': 'Grand Est', '51': 'Grand Est', '52': 'Grand Est', '54': 'Grand Est',
  '55': 'Grand Est', '57': 'Grand Est', '67': 'Grand Est', '68': 'Grand Est', '88': 'Grand Est',
  '02': 'Hauts-de-France', '59': 'Hauts-de-France', '60': 'Hauts-de-France',
  '62': 'Hauts-de-France', '80': 'Hauts-de-France',
  '75': 'Île-de-France', '77': 'Île-de-France', '78': 'Île-de-France', '91': 'Île-de-France',
  '92': 'Île-de-France', '93': 'Île-de-France', '94': 'Île-de-France', '95': 'Île-de-France',
  '14': 'Normandie', '27': 'Normandie', '50': 'Normandie', '61': 'Normandie', '76': 'Normandie',
  '16': 'Nouvelle-Aquitaine', '17': 'Nouvelle-Aquitaine', '19': 'Nouvelle-Aquitaine',
  '23': 'Nouvelle-Aquitaine', '24': 'Nouvelle-Aquitaine', '33': 'Nouvelle-Aquitaine',
  '40': 'Nouvelle-Aquitaine', '47': 'Nouvelle-Aquitaine', '64': 'Nouvelle-Aquitaine',
  '79': 'Nouvelle-Aquitaine', '86': 'Nouvelle-Aquitaine', '87': 'Nouvelle-Aquitaine',
  '09': 'Occitanie', '11': 'Occitanie', '12': 'Occitanie', '30': 'Occitanie', '31': 'Occitanie',
  '32': 'Occitanie', '34': 'Occitanie', '46': 'Occitanie', '48': 'Occitanie', '65': 'Occitanie',
  '66': 'Occitanie', '81': 'Occitanie', '82': 'Occitanie',
  '44': 'Pays de la Loire', '49': 'Pays de la Loire', '53': 'Pays de la Loire',
  '72': 'Pays de la Loire', '85': 'Pays de la Loire',
  '04': "Provence-Alpes-Côte d'Azur", '05': "Provence-Alpes-Côte d'Azur", '06': "Provence-Alpes-Côte d'Azur",
  '13': "Provence-Alpes-Côte d'Azur", '83': "Provence-Alpes-Côte d'Azur", '84': "Provence-Alpes-Côte d'Azur",
};

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
  // Fallback : code postal FR (5 chiffres) → département → région.
  const cp = raw.match(/(?:^|\D)(\d{2})\d{3}(?:\D|$)/);
  if (cp) {
    const dep = DEPT_REGION[cp[1]];
    if (dep) return dep;
  }
  return null;
}
