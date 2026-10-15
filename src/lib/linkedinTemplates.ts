// Gabarits des messages LinkedIn (premier message A / B / C, relance « post », relances R1 / R2 / R3).
// Les textes par défaut sont ceux du cahier des charges du 12/10/2026 ; Lomig peut les modifier dans
// l'onglet LinkedIn > Messages (linkedin_settings.msg_templates). Variables entre accolades.

// ── Règles de rédaction (cahier des charges) ──
export const MAX_CHARS = 300;
const BANNED = [
  /payment\s*flow/i, /marketing/i, /publicit/i, /\bpubs?\b/i, /\bsites?\b/i, /google/i, /\bmeta\b/i,
  /https?:|www\.|\.(fr|com)\b/i, /incroyable/i, /g[ée]nial/i, /inspirant/i, /exceptionnel/i, /extraordinaire/i,
  /je me permets/i, /avez-vous vu mon message/i, /d'o[uù] viennent/i, /quel canal/i,
];
const EMOJI = new RegExp('\\p{Extended_Pictographic}', 'u');

// Liste des règles non respectées par un message (vide = conforme)
export function checkMessage(msg: string, { first }: { first: boolean }): string[] {
  const issues: string[] = [];
  if (msg.length > MAX_CHARS) issues.push(`${msg.length} caractères (300 max)`);
  if (first && (msg.match(/[.?](\s|$)/g) ?? []).length > 3) issues.push('plus de 3 phrases');
  if (msg.includes('!')) issues.push('point d\'exclamation');
  if (EMOJI.test(msg)) issues.push('emoji');
  if (/[«»"“”]/.test(msg)) issues.push('guillemets');
  for (const re of BANNED) if (re.test(msg)) issues.push(`mot interdit (${re.source})`);
  return issues;
}

export type TemplateKey =
  | 'ouverture' | 'a' | 'b' | 'c_entreprise' | 'c' | 'post'
  | 'q_cout_client' | 'q_regularite' | 'qc_cout_client' | 'qc_regularite'
  | 'r1_cout_client' | 'r1_regularite' | 'r2_cout_client' | 'r2_regularite' | 'r3';

export const TEMPLATE_DEFAULTS: Record<TemplateKey, string> = {
  ouverture:      'Bonjour {prenom}, merci d\'avoir accepté.',
  a:              '{ouverture} J\'ai lu votre post sur {sujet}, votre point sur {element} est très juste. Je suis curieux : {question}',
  b:              '{ouverture} {fait}, ce n\'est pas rien. Je suis curieux : {question}',
  c_entreprise:   '{ouverture} J\'ai pris le temps de regarder ce que vous faites chez {entreprise}, c\'est un beau projet. Je suis curieux : {question}',
  c:              '{ouverture} J\'ai pris le temps de regarder ce que vous faites, c\'est un beau projet. Je suis curieux : {question}',
  post:           '{prenom}, je viens de voir votre post sur {sujet}, {element} m\'a fait sourire. Du coup, je repose ma question : {question_courte} ?',
  q_cout_client:  'aujourd\'hui, vous savez combien vous coûte un nouveau client ?',
  q_regularite:   'vos nouveaux clients arrivent plutôt régulièrement, ou ça dépend beaucoup des périodes ?',
  qc_cout_client: 'vous connaissez votre coût par nouveau client',
  qc_regularite:  'vos nouveaux clients, c\'est plutôt régulier ou en dents de scie',
  r1_cout_client: '{prenom}, je remonte mon message au cas où il serait passé sous la pile. La réponse tient en un mot : vous connaissez votre coût par nouveau client, oui ou non ?',
  r1_regularite:  '{prenom}, je remonte mon message au cas où il serait passé sous la pile. En un mot : vos nouveaux clients, c\'est plutôt régulier ou en dents de scie ?',
  r2_cout_client: 'Je vous pose la question parce que c\'est le chiffre qui permet de savoir combien investir pour grandir. Par exemple : savoir qu\'avec 10 € vous obtenez une demande, et qu\'il en faut 4 pour signer un client. Vous l\'avez déjà calculé {pour_entreprise} ?',
  r2_regularite:  'Je vous pose la question parce que la plupart des dirigeants avec qui j\'échange ont des mois pleins et des mois creux, sans savoir à l\'avance lesquels. {chez_entreprise}, c\'est plutôt prévisible ?',
  r3:             '{prenom}, je ne vais pas vous encombrer davantage. Dernière question : prévoir vos nouveaux clients, c\'est un sujet pour vous en ce moment, ou pas du tout ?',
};

// Description pour l'onglet Messages : groupe, titre, quand il part, variables disponibles
export const TEMPLATE_META: { key: TemplateKey; group: string; label: string; when: string; vars: string[] }[] = [
  { key: 'ouverture', group: 'Premier message', label: 'Ouverture', when: 'Début des variantes A, B et C', vars: ['prenom'] },
  { key: 'a', group: 'Premier message', label: 'Variante A · post récent', when: 'Le lead a publié un post exploitable de moins de 60 jours', vars: ['ouverture', 'sujet', 'element', 'question'] },
  { key: 'b', group: 'Premier message', label: 'Variante B · parcours', when: 'Pas de post, mais un fait marquant sur le profil', vars: ['ouverture', 'fait', 'question'] },
  { key: 'c_entreprise', group: 'Premier message', label: 'Variante C · avec entreprise', when: 'Ni post ni fait exploitable (modèle)', vars: ['ouverture', 'entreprise', 'question'] },
  { key: 'c', group: 'Premier message', label: 'Variante C · sans entreprise', when: 'Variante C sans nom d\'entreprise ou trop long', vars: ['ouverture', 'question'] },
  { key: 'q_cout_client', group: 'Questions', label: 'Question Q1 · coût client', when: 'Fin du premier message (une question sur deux)', vars: [] },
  { key: 'q_regularite', group: 'Questions', label: 'Question Q2 · régularité', when: 'Fin du premier message (une question sur deux)', vars: [] },
  { key: 'qc_cout_client', group: 'Questions', label: 'Q1 version courte', when: 'Dans la relance « post »', vars: [] },
  { key: 'qc_regularite', group: 'Questions', label: 'Q2 version courte', when: 'Dans la relance « post »', vars: [] },
  { key: 'post', group: 'Relances', label: 'Relance « post »', when: 'À la place d\'une relance, si le lead vient de publier', vars: ['prenom', 'sujet', 'element', 'question_courte'] },
  { key: 'r1_cout_client', group: 'Relances', label: 'R1 · Q1', when: 'R1 après le premier message (Q1)', vars: ['prenom', 'entreprise'] },
  { key: 'r1_regularite', group: 'Relances', label: 'R1 · Q2', when: 'R1 après le premier message (Q2)', vars: ['prenom', 'entreprise'] },
  { key: 'r2_cout_client', group: 'Relances', label: 'R2 · Q1', when: 'R2 (Q1)', vars: ['prenom', 'entreprise', 'pour_entreprise'] },
  { key: 'r2_regularite', group: 'Relances', label: 'R2 · Q2', when: 'R2 (Q2)', vars: ['prenom', 'entreprise', 'chez_entreprise'] },
  { key: 'r3', group: 'Relances', label: 'R3 · dernière relance', when: 'R3, puis fin de séquence', vars: ['prenom', 'entreprise'] },
];

export const VAR_HELP: Record<string, string> = {
  prenom: 'prénom du lead', entreprise: 'nom de son entreprise', ouverture: 'le gabarit « Ouverture »',
  question: 'la question Q1 ou Q2', question_courte: 'la question en version courte', sujet: 'sujet du post (choisi par l\'agent)',
  element: 'point du post (cité par l\'agent)', fait: 'fait du parcours (cité par l\'agent)',
  pour_entreprise: '« pour <entreprise> » ou « pour votre activité »', chez_entreprise: '« Chez <entreprise> » ou « Chez vous »',
};

let current: Record<TemplateKey, string> = TEMPLATE_DEFAULTS;

// Gabarits en vigueur : ceux de Lomig (non vides) par-dessus les textes par défaut
export function setTemplates(overrides?: Partial<Record<string, string>> | null): void {
  const o = Object.fromEntries(Object.entries(overrides ?? {})
    .filter(([k, v]) => k in TEMPLATE_DEFAULTS && typeof v === 'string' && v.trim()).map(([k, v]) => [k, (v as string).trim()]));
  current = { ...TEMPLATE_DEFAULTS, ...o };
}

export function tpl(key: TemplateKey, vars: Record<string, string>): string {
  return current[key].replace(/\{(\w+)\}/g, (m, v) => (v in vars ? vars[v] : m)).replace(/[ \t]{2,}/g, ' ').trim();
}
