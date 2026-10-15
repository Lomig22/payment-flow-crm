// Libellés de la séquence LinkedIn, partagés par le serveur et la page /linkedin (aucune dépendance serveur)

export const LI_STATUS_LABELS: Record<string, string> = {
  to_invite:   'En séquence',
  invited:     'Invitation envoyée',
  expired:     'Invitation expirée',
  connected:   'Invitation acceptée',
  to_validate: 'Message à valider',
  ready:       'Message prêt',
  first_sent:  'Premier message envoyé',
  // R1 … R16 envoyée(s)
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i + 1}_sent`, `R${i + 1} envoyée`])),
  no_reply:    'Sans réponse',
  to_resume:   'À reprendre',
  dnc:         'Ne plus contacter',
  failed:      'Erreur',
};
export const SECTORS: Record<string, string> = {
  agence_immo:            'Agence immobilière',
  renovation_energetique: 'Rénovation énergétique',
  cuisiniste:             'Cuisiniste / bainiste',
  piscine_paysage:        'Piscine / paysage',
  menuiserie:             'Menuiserie',
};

export type Question = 'cout_client' | 'regularite';
export const QUESTION_LABELS: Record<Question, string> = { cout_client: 'Q1 coût client', regularite: 'Q2 régularité' };
export type Stage = 'first' | `r${number}`;
export const STAGE_LABELS: Record<string, string> = {
  first: 'Premier message', post: 'Relance post',
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i + 1}`, `R${i + 1}`])),
};
