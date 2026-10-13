import CITY_REGION from './city-regions.json';

// Script M1 Instagram (premier DM), personnalisé à partir des données du lead.
//   DM à froid :
//     « Hello ! Je suis tombé sur ton compte via [hashtag], tes réalisations en
//       [métier] sont vraiment propres. Tu interviens surtout autour de [ville], ou
//       tu bouges aussi pas mal ailleurs en [région] ? »
//   Après un follow back (piste follow) : l'accroche remercie pour le follow —
//     « Hello ! Merci pour ton follow ! J'ai jeté un œil à ton compte, tes
//       réalisations en [métier]… »
// Ton : « Hello » plutôt que « Bonjour » (moins froid en DM).
// Chaque variable a une formulation de repli quand l'info manque, pour ne
// jamais envoyer un « [ville] » brut.
//
// Règles de personnalisation (le message n'affirme que ce qu'on sait du compte) :
//   • aucune publication / compte privé → pas de compliment sur les réalisations
//   • 1 à 3 publications               → « tes premiers posts… »
//   • vocabulaire selon le métier      → chantiers / créations / réalisations…
//   • prénom détecté dans le nom       → « Hello Julien ! »
//   • localisation = région            → « partout en Alsace, ou surtout autour d'une ville ? »
// Contrainte : jamais plus long que le script d'origine (baselineM1) — garde-fou
// appliqué à l'exécution, la personnalisation est réduite si elle dépasse.

type DmLead = {
  instagram_username?: string | null;
  company?: string | null;
  location?: string | null;
  niche?: string | null;
  bio?: string | null;
  notes?: string | null;
  status?: string | null;
  ig_outreach?: string | null;
  posts_count?: number | null;   // nombre de publications (null = inconnu)
  is_private?: boolean | null;   // compte privé : publications non visibles
};

const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Villes du mapping, clé normalisée sans séparateurs, les plus longues d'abord
// (« aixenprovence » avant « aix »).
const CITIES = Object.entries(CITY_REGION as Record<string, string>)
  .map(([name, region]) => ({ name, region, key: norm(name).replace(/[^a-z0-9]/g, '') }))
  .sort((a, b) => b.key.length - a.key.length);

// « ailleurs en Bretagne », « ailleurs dans le Grand Est »…
const REGION_ELSEWHERE: Record<string, string> = {
  'Auvergne-Rhône-Alpes':        'ailleurs en Auvergne-Rhône-Alpes',
  'Bourgogne-Franche-Comté':     'ailleurs en Bourgogne-Franche-Comté',
  'Bretagne':                    'ailleurs en Bretagne',
  'Centre-Val de Loire':         'ailleurs en Centre-Val de Loire',
  'Corse':                       'ailleurs en Corse',
  'Grand Est':                   'ailleurs dans le Grand Est',
  'Hauts-de-France':             'ailleurs dans les Hauts-de-France',
  'Île-de-France':               'ailleurs en Île-de-France',
  'Normandie':                   'ailleurs en Normandie',
  'Nouvelle-Aquitaine':          'ailleurs en Nouvelle-Aquitaine',
  'Occitanie':                   'ailleurs en Occitanie',
  'Pays de la Loire':            'ailleurs dans les Pays de la Loire',
  "Provence-Alpes-Côte d'Azur":  'ailleurs en PACA',
  'Luxembourg':                  'ailleurs au Luxembourg',
};

// Métier du lead → complément de « tes réalisations en … ».
const NICHE_ACTIVITY: Record<string, string> = {
  'Plombier': 'plomberie', 'Électricien': 'électricité', 'Peintre': 'peinture',
  'Menuisier': 'menuiserie', 'Couvreur': 'couverture', 'Maçon': 'maçonnerie',
  'Carreleur': 'carrelage', 'Plaquiste': 'placo', 'Climatisation': 'climatisation',
  'Multi-corps': 'rénovation',
};

// Déduction depuis @, nom, bio, hashtag — du plus spécifique au plus générique.
const ACTIVITY_KEYWORDS: [RegExp, string][] = [
  [/salle ?de ?bain|sdb/, 'salle de bain'],
  [/plomb/, 'plomberie'],
  [/electri|(^|[^a-z])elec([^a-z]|$)/, 'électricité'],
  [/carrel/, 'carrelage'],
  [/placo|plaqu|platr/, 'placo'],
  [/peint/, 'peinture'],
  [/menuis|ebenist/, 'menuiserie'],
  [/charpent/, 'charpente'],
  [/couvreur|couverture|toitur/, 'couverture'],
  [/macon/, 'maçonnerie'],
  [/terrassement|terrassier/, 'terrassement'],
  [/terrasse/, 'terrasses'],
  [/ravalement|facad/, 'façade'],
  [/comble/, 'isolation des combles'],
  [/isolation|(^|[^a-z])ite([^a-z]|$)/, 'isolation'],
  [/clim/, 'climatisation'],
  [/serrur/, 'serrurerie'],
  [/chauffag/, 'chauffage'],
  [/vitr/, 'vitrerie'],
  [/paysag/, 'aménagement extérieur'],
  [/renov|batiment|btp/, 'rénovation'],
];

function hashtagOf(lead: DmLead): string | null {
  const m = (lead.notes ?? '').match(/#([A-Za-z0-9_À-ÿ]{3,})/);
  return m ? m[1] : null;
}

function activityOf(lead: DmLead, hashtag: string | null): string | null {
  const fromNiche = lead.niche ? NICHE_ACTIVITY[lead.niche.trim()] : undefined;
  if (fromNiche) return fromNiche;
  const hay = norm([lead.instagram_username, lead.company, hashtag, lead.bio].filter(Boolean).join(' '));
  for (const [re, activity] of ACTIVITY_KEYWORDS) if (re.test(hay)) return activity;
  return null;
}

// Gentilés fréquents dans les @ (« couvreurs.lyonnais ») → ville.
const DEMONYMS: [string, string][] = [
  ['lyonnais', 'Lyon'], ['marseillais', 'Marseille'], ['toulousain', 'Toulouse'],
  ['bordelais', 'Bordeaux'], ['parisien', 'Paris'], ['nantais', 'Nantes'],
  ['lillois', 'Lille'], ['nicois', 'Nice'], ['grenoblois', 'Grenoble'],
  ['montpellierain', 'Montpellier'], ['rennais', 'Rennes'], ['strasbourgeois', 'Strasbourg'],
];

function cityOf(lead: DmLead): { name: string; region: string } | null {
  // 1) localisation renseignée : ville connue exacte, ou segment d'adresse
  if (lead.location) {
    for (const part of [lead.location, ...lead.location.split(/[,;]/)]) {
      const key = norm(part).replace(/^\d{5}\s*/, '').replace(/[^a-z0-9]/g, '');
      const hit = CITIES.find((c) => c.key === key);
      if (hit) return hit;
    }
  }
  // 2) déduction depuis le @, puis le nom, puis la bio (le @ est le plus fiable :
  //    « nice.menuiserie » dont le nom cite Cannes → Nice). Mot isolé
  //    (« renovation_toulouse ») : toute ville. Collé au reste : en fin de mot
  //    dès 4 lettres (« plombierlyon »), en début dès 5 (« lillepeintre »),
  //    au milieu dès 6 — « agen » en tête d'« agencement » reste ignoré.
  for (const field of [lead.instagram_username, lead.company, lead.bio]) {
    if (!field) continue;
    const text = norm(field);
    // « lyon69 » → « lyon » : on retire le n° de département collé en fin de mot
    const tokens = text.split(/[^a-z0-9]+/).filter(Boolean).map((t) => t.replace(/\d+$/, '')).filter(Boolean);
    const glued = text.replace(/[^a-z0-9]/g, '');
    const demonym = DEMONYMS.find(([d]) => glued.includes(d));
    if (demonym) {
      const c = CITIES.find((x) => x.name === demonym[1]);
      if (c) return c;
    }
    const hit = CITIES.find((c) => tokens.includes(c.key))
      ?? CITIES.find((c) => tokens.some((t) =>
           (c.key.length >= 4 && t.endsWith(c.key)) || (c.key.length >= 5 && t.startsWith(c.key))))
      ?? CITIES.find((c) => c.key.length >= 6 && glued.includes(c.key));
    if (hit) return hit;
  }
  return null;
}

// « autour de Lyon », « autour d'Angers », « autour du Havre », « autour des Sables-d'Olonne »
function autourDe(city: string): string {
  if (/^Le /i.test(city))  return `autour du ${city.slice(3)}`;
  if (/^Les /i.test(city)) return `autour des ${city.slice(4)}`;
  return 'aeiouy'.includes(norm(city).charAt(0)) ? `autour d'${city}` : `autour de ${city}`;
}

// ── Règles de personnalisation ─────────────────────────────────────────

// Mot qui désigne le travail, selon le métier (jamais plus long que « réalisations »).
const WORK_WORD: Record<string, string> = {
  'menuiserie': 'créations', 'charpente': 'créations',
  'maçonnerie': 'chantiers', 'couverture': 'chantiers', 'terrassement': 'chantiers',
  'rénovation': 'chantiers', 'isolation': 'chantiers', 'isolation des combles': 'chantiers',
  'façade': 'chantiers', 'plomberie': 'chantiers', 'électricité': 'chantiers',
  'climatisation': 'chantiers', 'chauffage': 'chantiers',
};
// Métiers qui se disent mieux au pluriel direct : « tes terrasses sont… »
const OWN_PLURAL: Record<string, string> = {
  'terrasses': 'terrasses', 'salle de bain': 'salles de bain',
  'aménagement extérieur': 'aménagements extérieurs',
};

// Variantes de formulation : un compte n'envoie pas deux fois de suite le même
// texte. La variante 0 est la formulation d'origine ; les autres ne sont jamais
// plus longues (garde-fou de longueur dans buildM1).
const pick = <T,>(list: T[], i: number): T => list[((i % list.length) + list.length) % list.length];

// Rien de visible à complimenter : aucune publication, ou compte privé.
const nothingToSee = (lead: DmLead) => lead.is_private === true || lead.posts_count === 0;

function workPhrase(lead: DmLead, activity: string | null, i: number): string {
  const plural = activity ? OWN_PLURAL[activity] : undefined;
  if (nothingToSee(lead)) {
    if (!activity) return pick(['ton profil a attiré mon attention', "ton profil m'a interpellé", 'ton compte a attiré mon attention', "ton profil m'a tapé dans l'œil"], i);
    const does = plural ? `tu fais des ${plural}` : `tu bosses en ${activity}`;
    return pick([`j'ai vu que ${does}`, `je vois que ${does}`, `${does} si j'ai bien vu`, `${does} d'après ton profil`], i);
  }
  if (lead.posts_count != null && lead.posts_count <= 3) {
    const what = activity && !plural ? `tes premiers posts en ${activity}` : 'tes premiers posts';
    return pick([`${what} sont propres`, `${what} sont top`, `j'aime bien ${what}`, `${what} donnent envie`, `${what} sont nickel`, `bon début avec ${what}`], i);
  }
  const what = !activity ? 'tes réalisations'
    : plural ? `tes ${plural}`
    : `tes ${WORK_WORD[activity] ?? 'réalisations'} en ${activity}`;
  return pick([
    `${what} sont vraiment propres`,
    `${what} sont super propres`,
    `j'aime beaucoup ${what}`,
    `${what} sont vraiment au top`,
    `beau boulot sur ${what}`,
    `${what} sont nickel`,
    `${what} ont de la gueule`,
    `chapeau pour ${what}`,
  ], i);
}

function zonePhrase(city: { name: string; region: string } | null, area: string | null, i: number): string {
  if (city) {
    const around = autourDe(city.name);
    const beyond = REGION_ELSEWHERE[city.region] ?? 'dans les environs';
    return pick([
      `Tu interviens surtout ${around}, ou tu bouges aussi pas mal ${beyond} ?`,
      `Tu bosses surtout ${around}, ou tu te déplaces aussi ${beyond} ?`,
      `Tu es plutôt ${around}, ou tu interviens aussi ${beyond} ?`,
      `Tes chantiers sont surtout ${around}, ou aussi ${beyond} ?`,
      `Tu restes plutôt ${around}, ou tu vas aussi ${beyond} ?`,
      `Tu travailles surtout ${around}, ou tu prends aussi des chantiers ${beyond} ?`,
    ], i);
  }
  if (area) {
    return pick([
      `Tu interviens partout ${area}, ou surtout autour d'une ville ?`,
      `Tu bosses partout ${area}, ou surtout autour d'une ville ?`,
      `Tu te déplaces partout ${area}, ou plutôt autour d'une ville ?`,
      `Tu couvres tout le secteur ${area}, ou plutôt une ville en particulier ?`,
    ], i);
  }
  return pick([
    'Tu interviens surtout en local, ou tu te déplaces aussi pas mal dans la région ?',
    'Tu bosses surtout en local, ou tu te déplaces aussi dans la région ?',
    'Tu restes plutôt en local, ou tu bouges aussi pas mal dans la région ?',
    'Tes chantiers sont surtout en local, ou aussi dans toute la région ?',
    'Tu restes dans ton secteur, ou tu prends aussi des chantiers plus loin ?',
    'Tu travailles surtout autour de chez toi, ou tu te déplaces aussi ?',
  ], i);
}

function introPhrase(name: string | null, hashtag: string | null, i: number): string {
  if (hashtag) {
    return name
      ? pick([`J'ai vu ton compte via #${hashtag}`, `J'ai découvert ton compte via #${hashtag}`, `Je viens de voir ton compte via #${hashtag}`], i)
      : pick([`Je suis tombé sur ton compte via #${hashtag}`, `J'ai découvert ton compte via #${hashtag}`, `J'ai vu passer ton compte via #${hashtag}`, `Je viens de voir ton compte via #${hashtag}`, `J'ai croisé ton compte via #${hashtag}`, `Ton compte est ressorti sur #${hashtag}`], i);
  }
  return name
    ? pick(["J'ai vu ton compte sur Insta", "J'ai découvert ton compte sur Insta", 'Je viens de voir ton compte sur Insta', "J'ai vu passer ton compte sur Insta"], i)
    : pick([
        'Je suis tombé sur ton compte en parcourant Insta',
        "J'ai découvert ton compte en scrollant sur Insta",
        'Je viens de voir passer ton compte sur Insta',
        'Ton compte est apparu dans mes suggestions Insta',
        "J'ai vu passer ton compte en scrollant Insta",
        "J'ai croisé ton compte sur Insta",
        'Ton profil est ressorti dans mon fil',
      ], i);
}

// Localisation au niveau région / ancien territoire (« Alsace », « Ile de France »).
const AREA_PHRASES: Record<string, string> = {
  ...Object.fromEntries(Object.entries(REGION_ELSEWHERE).map(([name, p]) =>
    [norm(name).replace(/[^a-z0-9]/g, ''), p.replace(/^ailleurs /, '')])),
  idf: 'en Île-de-France', paca: 'en PACA', rhonealpes: 'en Rhône-Alpes', auvergne: 'en Auvergne',
  alsace: 'en Alsace', lorraine: 'en Lorraine', aquitaine: 'en Aquitaine', bourgogne: 'en Bourgogne',
  franchecomte: 'en Franche-Comté', picardie: 'en Picardie', languedoc: 'en Languedoc',
  languedocroussillon: 'en Languedoc-Roussillon', midipyrenees: 'en Midi-Pyrénées',
  provence: 'en Provence', cotedazur: "sur la Côte d'Azur", paysbasque: 'au Pays basque',
  savoie: 'en Savoie', hautesavoie: 'en Haute-Savoie', vendee: 'en Vendée', gironde: 'en Gironde',
  champagne: 'en Champagne', limousin: 'en Limousin', poitoucharentes: 'en Poitou-Charentes',
};
function areaOf(lead: DmLead): string | null {
  if (!lead.location) return null;
  for (const part of [lead.location, ...lead.location.split(/[,;]/)]) {
    const key = norm(part).replace(/\bregion\b/g, '').replace(/[^a-z0-9]/g, '');
    if (AREA_PHRASES[key]) return AREA_PHRASES[key];
  }
  return null;
}

// Prénoms courants. Beaucoup sont aussi des noms de famille (« Martin Couverture »
// = entreprise Martin) : on ne retient le prénom que s'il n'est pas suivi
// directement d'un métier ou d'un mot d'entreprise.
const FIRST_NAMES = [
  'Adrien','Alain','Alex','Alexandre','Alexis','Anthony','Antoine','Arnaud','Arthur','Aurélien','Axel',
  'Baptiste','Benjamin','Benoît','Bruno','Cédric','Charles','Christian','Christophe','Clément','Corentin',
  'Cyril','Damien','Daniel','David','Denis','Didier','Dylan','Emmanuel','Éric','Erwan','Étienne',
  'Fabien','Fabrice','Florent','Florian','Franck','François','Frédéric','Gaël','Gaëtan','Geoffrey',
  'Gilles','Grégory','Guillaume','Hervé','Hugo','Jérémie','Jérémy','Jérôme','Joël','Jonathan','Jordan',
  'Julien','Kevin','Kévin','Laurent','Loïc','Louis','Luc','Lucas','Ludovic','Marc','Mathieu','Matthieu',
  'Maxime','Mehdi','Mickaël','Michaël','Mohamed','Nathan','Nicolas','Olivier','Pascal','Patrice',
  'Patrick','Paul','Philippe','Pierre','Quentin','Raphaël','Rémi','Rémy','Romain','Samuel','Sébastien',
  'Stéphane','Sylvain','Théo','Thibault','Thibaut','Thierry','Thomas','Tony','Valentin','Victor',
  'Vincent','William','Xavier','Yann','Yannick','Yoann','Yohan',
  'Amandine','Aurélie','Camille','Caroline','Céline','Charlotte','Chloé','Claire','Élodie','Émilie',
  'Julie','Laura','Laurie','Léa','Lucie','Manon','Marie','Marine','Marion','Mathilde','Mélanie',
  'Pauline','Sarah','Sophie','Stéphanie',
  'Jean-Baptiste','Jean-Claude','Jean-François','Jean-Luc','Jean-Marc','Jean-Michel','Jean-Paul',
  'Jean-Pierre','Pierre-Yves',
];
const FIRST_NAME_INDEX = new Map(FIRST_NAMES.map((n) => [norm(n), n]));
const COMPANY_WORD = /^(sarl|sas|sasu|eurl|ets|entreprise|societe|groupe|btp|tp|services?|habitat|batiment|deco|design|construction|concept|renov|renovation|artisan|pro|et|fils|freres|france|co)$/;

function firstNameOf(lead: DmLead): string | null {
  const raw = (lead.company ?? '').trim();
  const m = raw.match(/^[A-Za-zÀ-ÿ]+(?:-[A-Za-zÀ-ÿ]+)?/);
  if (!m) return null;
  const name = FIRST_NAME_INDEX.get(norm(m[0]));
  if (!name) return null;
  const rest = raw.slice(m[0].length).trim();
  if (!rest) return name;
  if (/^(&|\+)/.test(rest)) return null;          // « Pierre & Filet Maçonnerie » : raison sociale
  const next = rest.match(/^[A-Za-zÀ-ÿ]+/);
  if (!next) return name;                       // suivi d'un séparateur / emoji : « Julien | Électricien »
  const word = norm(next[0]);
  if (COMPANY_WORD.test(word)) return null;     // « Thomas Habitat »
  if (ACTIVITY_KEYWORDS.some(([re]) => re.test(word))) return null;   // « Martin Couverture »
  if (CITIES.some((c) => c.key === word)) return null;                // « Nicolas Lyon »
  return name;                                  // « Julien Dupont … » : prénom + nom
}

const isFollowBackLead = (lead: DmLead) => lead.status === 'followed_back' || lead.ig_outreach === 'follow';
const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// Script d'origine (avant règles) : sert de plafond de longueur.
export function baselineM1(lead: DmLead): string {
  const hashtag  = hashtagOf(lead);
  const activity = activityOf(lead, hashtag);
  const city     = cityOf(lead);
  const via = hashtag ? `via #${hashtag}` : 'en parcourant Insta';
  const realisations = activity
    ? `tes réalisations en ${activity} sont vraiment propres`
    : 'tes réalisations sont vraiment propres';
  const zone = city
    ? `Tu interviens surtout ${autourDe(city.name)}, ou tu bouges aussi pas mal ${REGION_ELSEWHERE[city.region] ?? 'dans les environs'} ?`
    : 'Tu interviens surtout en local, ou tu te déplaces aussi pas mal dans la région ?';
  return isFollowBackLead(lead)
    ? `Hello ! Merci pour ton follow ! J'ai jeté un œil à ton compte, ${realisations}. ${zone}`
    : `Hello ! Je suis tombé sur ton compte ${via}, ${realisations}. ${zone}`;
}

// Chaque élément du message (salutation, structure, découverte, compliment, question) est tiré
// indépendamment des autres (hachage de la variante avec un sel propre à l'élément) : deux
// variantes consécutives diffèrent sur plusieurs éléments à la fois. Instagram repère les DM
// trop semblables (demande de Lomig du 09/10/2026 : varier davantage).
const RADIX = [3, 3, 8, 8, 8];   // salutation, structure, découverte, compliment, question
const hash = (v: number, salt: number) => {
  let h = Math.imul(v + 1, 0x9e3779b1) ^ Math.imul(salt + 7, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  return (h ^ (h >>> 12)) >>> 0;
};
const digitsOf = (v: number) => RADIX.map((r, k) => hash(v, k) % (k < 2 ? r : 840));   // 840 : divisible par 4 à 8
const lowerFirst = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

function compose(lead: DmLead, name: string | null, v: number): string {
  const [g, st, di, wi, zi] = digitsOf(v);
  const hashtag  = hashtagOf(lead);
  const activity = activityOf(lead, hashtag);
  const city     = cityOf(lead);
  const area     = city ? null : areaOf(lead);
  const work     = workPhrase(lead, activity, wi);
  const zone     = zonePhrase(city, area, zi);
  // Salutation : « Hello ! », « Hello 👋 » ou « Hello, … » (la phrase suivante continue alors en minuscule)
  const comma = g === 2;
  const hello = name ? [`Hello ${name} !`, `Hello ${name} 👋`, `Hello ${name},`][g] : ['Hello !', 'Hello 👋', 'Hello,'][g];
  const open = (t: string) => `${hello} ${comma ? lowerFirst(t) : capitalize(t)}`;

  if (isFollowBackLead(lead)) {
    const thanks = pick(name
      ? ['Merci pour le follow !', 'Merci pour ton follow !', 'Merci pour le follow back !', "Merci pour l'abonnement !"]
      : ['Merci pour ton follow !', 'Merci pour le follow !', 'Merci pour le follow back !', "Merci de m'avoir suivi !"], di);
    // Rien de visible sur le compte : on ne prétend pas l'avoir regardé.
    if (nothingToSee(lead)) return `${open(thanks)} ${capitalize(work)}. ${zone}`;
    const looked = pick(name
      ? ["J'ai regardé ton compte", "J'ai parcouru ton compte", "J'ai jeté un œil à ton compte", 'Je suis allé voir ton compte']
      : ["J'ai jeté un œil à ton compte", "J'ai regardé ton compte", 'Je viens de regarder ton compte', "J'ai parcouru ton compte", 'Je suis allé voir ton compte'], di + 1);
    return st === 1
      ? `${open(thanks)} ${looked} : ${work}. ${zone}`
      : `${open(thanks)} ${looked}, ${work}. ${zone}`;
  }
  const intro = introPhrase(name, hashtag, di);
  // Trois structures : découverte puis compliment ; deux phrases ; compliment d'abord
  if (st === 1) return `${open(intro)}. ${capitalize(work)} ! ${zone}`;
  if (st === 2) return `${open(work)}, ${lowerFirst(intro)}. ${zone}`;
  return `${open(intro)}, ${work}. ${zone}`;
}

// Nombre de variantes avant de reboucler (cycle des rangs d'envoi)
export const M1_VARIANTS = RADIX.reduce((a, b) => a * b, 1);

/**
 * Message M1 personnalisé.
 *  - `seq`   : rang du message dans la session du compte d'envoi — deux rangs
 *              consécutifs donnent toujours deux formulations différentes ;
 *  - `avoid` : variantes récemment envoyées par ce compte, à ne pas reprendre.
 * Garantit : jamais plus long que le script d'origine (baselineM1).
 */
export function buildM1(lead: DmLead, opts: { seq?: number; avoid?: string[] } = {}): { text: string; variant: string } {
  const max   = baselineM1(lead).length;
  const avoid = new Set(opts.avoid ?? []);
  const start = Math.max(0, Math.floor(opts.seq ?? 0));
  const name  = firstNameOf(lead);

  let fallback: { text: string; variant: string } | null = null;
  // Chaque rang démarre loin du précédent (pas × 7919) : quand une variante est trop longue, le
  // repli sur la suivante ne retombe pas sur la variante du rang d'après (pas de doublon consécutif)
  const base = (start * 7919) % M1_VARIANTS;
  for (let k = 0; k < M1_VARIANTS; k++) {
    const v = (base + k) % M1_VARIANTS;
    const candidates = name ? [compose(lead, name, v), compose(lead, null, v)] : [compose(lead, null, v)];
    const text = candidates.find((t) => t.length <= max);
    if (!text) continue;
    const found = { text, variant: String(v) };
    if (!avoid.has(found.variant)) return found;
    fallback ??= found;                       // toutes récemment utilisées : on prend la première valide
  }
  return fallback ?? { text: baselineM1(lead), variant: 'base' };
}

export function buildM1Message(lead: DmLead): string {
  return buildM1(lead).text;
}
