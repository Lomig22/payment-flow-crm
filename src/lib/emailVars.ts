// Variables de personnalisation des mails (emailing via Hermès). Calculées par le CRM à partir des
// données du lead (nettoyées, au format français), utilisables dans les objets et les corps de mail :
//   {entreprise}  ou  {{entreprise}}      → valeur
//   {ville|votre ville}                   → valeur, ou le texte après « | » si la donnée manque
// Partagé par le serveur (mails remis à Hermès) et la page Emailing (aperçu) : aucune dépendance serveur.

export interface VarLead {
  email?: string | null; first_name?: string | null; last_name?: string | null; company?: string | null;
  job_title?: string | null; sector?: string | null; city?: string | null; website?: string | null;
  phone?: string | null; custom?: Record<string, unknown> | null;
}

// Région à partir du département (métropole)
const REGIONS: Record<string, string[]> = {
  'Auvergne-Rhône-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  'Bourgogne-Franche-Comté': ['21', '25', '39', '58', '70', '71', '89', '90'],
  'Bretagne': ['22', '29', '35', '56'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  'Corse': ['2A', '2B', '20'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  'Normandie': ['14', '27', '50', '61', '76'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  'Occitanie': ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  "Provence-Alpes-Côte d'Azur": ['04', '05', '06', '13', '83', '84'],
};
const regionOf = (dep: string) => Object.entries(REGIONS).find(([, deps]) => deps.includes(dep))?.[0] ?? '';

const str = (v: unknown) => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim());
const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
const fr = (n: number, d = 1) => n.toLocaleString('fr-FR', { minimumFractionDigits: 0, maximumFractionDigits: d });

// Nom d'entreprise lisible : Google Maps ajoute souvent des mots-clés (« GR COUVERTURE LILLOISE :
// Couverture - étanchéité… ») → partie avant « : », « | », « - », « / », « ( », « , » ; nom trop long coupé
// avant le premier mot de métier ; majuscules adoucies
const LEGAL = /^(sarl|sas|sasu|eurl|sa|snc|sci|scop|selarl|ei|eirl|micro-entreprise|auto-entrepreneur)$/i;
const TRADE_WORD = /^(travaux|r[ée]novation|renov|finitions?|salle|ma[çc]onnerie|plomberie|[ée]lectricit[ée]|chauffage|couverture|peinture|menuiserie|carrelage|isolation|construction|b[âa]timent|terrassement|am[ée]nagement|[ée]tanch[ée]it[ée]|toiture|charpente|services?|multi)$/i;
export function cleanCompany(raw: string): string {
  // Formes juridiques écrites avec des points (« S.A.R.L. ») retirées avant le découpage
  const base = str(raw).replace(/(^|\s)(S\.A\.R\.L|S\.A\.S\.U|S\.A\.S|E\.U\.R\.L|S\.N\.C|S\.C\.I|E\.I)\.?(?=\s|$)/gi, ' ').trim() || str(raw);
  let words = base.split(/\s[:|–—/-]\s|\s\(|,\s?|\s\||\s\/|(?<=[a-zà-ÿ]{3})\.\s/)[0].trim().replace(/[.\s]+$/, '').split(' ');
  // Nom long : coupé avant le premier mot de métier (après au moins deux mots)
  if (words.join(' ').length > 26) {
    const i = words.findIndex((w, k) => k >= 2 && TRADE_WORD.test(w));
    if (i > 0) words = words.slice(0, i);
  }
  // Forme juridique retirée (SARL, SAS, EURL…) : ce n'est pas le nom de l'entreprise
  const named = words.filter((w) => !LEGAL.test(w.replace(/[.,]/g, '')));
  if (named.length) words = named;
  let s = words.join(' ');
  if (s.length > 40) s = s.slice(0, 40).replace(/\s+\S*$/, '');
  // Mots tout en capitales adoucis (« RENOV » → « Renov »), sauf sigles courts et formes juridiques
  return s.split(' ').map((w) => (w.length > 3 && w === w.toUpperCase() && /[A-ZÀ-Ý]{4,}/.test(w)
    ? w.charAt(0) + w.slice(1).toLowerCase() : w)).join(' ');
}

// « maçon » → « maçons » ; « artisan en rénovation » → « artisans en rénovation »
function plural(metier: string): string {
  if (!metier) return '';
  const [first, ...rest] = metier.split(' ');
  const p = /[sxz]$/.test(first) ? first : first.endsWith('al') ? `${first.slice(0, -2)}aux` : `${first}s`;
  return [p, ...rest].join(' ');
}

export function buildVars(l: VarLead): Record<string, string> {
  const c = l.custom ?? {};
  const company = str(l.company);
  const metier = lowerFirst(str(l.sector) || str(c.specialite) || str(c.metier));
  const ville = str(l.city);
  const dep = str(c.departement ?? c.code_departement).padStart(2, '0').replace(/^00$/, '');
  const note = Number(str(c.note_google ?? c.note).replace(',', '.'));
  const avis = Number(str(c.nb_avis ?? c.avis).replace(/\D/g, ''));
  const site = str(l.website);
  const domain = site.replace(/^https?:\/\//i, '').replace(/^www\./i, '').split(/[/?#]/)[0];
  const prenom = str(l.first_name).replace(/^./, (m) => m.toUpperCase());
  const hasNote = Number.isFinite(note) && note > 0, hasAvis = Number.isFinite(avis) && avis > 0;

  const vars: Record<string, string> = {
    // Identité
    prenom, nom: str(l.last_name),
    bonjour: prenom ? `Bonjour ${prenom}` : 'Bonjour',
    entreprise: cleanCompany(company), entreprise_complet: company,
    // Métier
    metier, metiers: plural(metier), un_metier: metier ? `un ${metier}` : '',
    // Lieu
    ville, a_ville: ville ? `à ${ville}` : '', departement: dep, region: regionOf(dep),
    // Réputation Google
    note_google: hasNote ? fr(note) : '', nb_avis: hasAvis ? String(avis) : '',
    avis_google: hasNote && hasAvis ? `${fr(note)}/5 sur ${avis} avis Google` : '',
    // Présence en ligne
    site: domain, site_url: site, fiche_google: str(c.url_fiche_google),
  };
  // Toute autre colonne du fichier importé : {nom_de_colonne}
  for (const [k, v] of Object.entries(c)) if (!(k in vars) && str(v)) vars[k] = str(v);
  return vars;
}

// Liste et description des variables (page Emailing)
export const VARS_HELP: { key: string; label: string }[] = [
  { key: 'entreprise', label: 'Nom de l\'entreprise, nettoyé (sans les mots-clés Google Maps)' },
  { key: 'entreprise_complet', label: 'Nom tel qu\'importé' },
  { key: 'metier', label: 'Métier (maçon, plombier, artisan en rénovation…)' },
  { key: 'metiers', label: 'Métier au pluriel (maçons…)' },
  { key: 'un_metier', label: '« un maçon »' },
  { key: 'ville', label: 'Ville' },
  { key: 'a_ville', label: '« à Lille »' },
  { key: 'departement', label: 'Numéro de département' },
  { key: 'region', label: 'Région (déduite du département)' },
  { key: 'note_google', label: 'Note Google (« 4,8 »)' },
  { key: 'nb_avis', label: 'Nombre d\'avis Google' },
  { key: 'avis_google', label: '« 4,8/5 sur 17 avis Google »' },
  { key: 'site', label: 'Site sans https ni www (« trahay.com ») — leads avec site' },
  { key: 'site_url', label: 'Adresse complète du site' },
  { key: 'fiche_google', label: 'Lien de la fiche Google Maps — leads sans site' },
  { key: 'bonjour', label: '« Bonjour Prénom », ou « Bonjour » sans prénom' },
  { key: 'prenom', label: 'Prénom (vide pour l\'instant : aucun prénom dans tes leads)' },
];

// Remplace {var}, {{var}} et {var|secours}. Variable inconnue ou vide sans secours : retirée.
// `missing` : variables restées vides (aperçu : signale les trous)
export function renderVars(text: string, vars: Record<string, string>, missing?: Set<string>): string {
  return (text ?? '')
    .replace(/\{\{?\s*([\w-]+)\s*(?:\|([^{}]*))?\}?\}/g, (_m, k: string, fallback?: string) => {
      const v = vars[k] ?? vars[k.toLowerCase()] ?? '';
      if (v) return v;
      if (fallback !== undefined) return fallback.trim();
      missing?.add(k);
      return '';
    })
    .replace(/[ \t]{2,}/g, ' ').replace(/ +([,.])/g, '$1');
}
