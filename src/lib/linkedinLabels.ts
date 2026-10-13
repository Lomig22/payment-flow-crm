// Libellés de la séquence LinkedIn, partagés par le serveur et la page /linkedin (aucune dépendance serveur)

export const LI_STATUS_LABELS: Record<string, string> = {
  to_invite:   'En séquence',
  invited:     'Invitation envoyée',
  expired:     'Invitation expirée',
  connected:   'Invitation acceptée',
  to_validate: 'Message à valider',
  ready:       'Message prêt',
  first_sent:  'Premier message envoyé',
  r1_sent:     'R1 envoyée',
  r2_sent:     'R2 envoyée',
  r3_sent:     'R3 envoyée',
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
export type Stage = 'first' | 'r1' | 'r2' | 'r3';
export const STAGE_LABELS: Record<string, string> = { first: 'Premier message', r1: 'R1', r2: 'R2', r3: 'R3', post: 'Relance post' };
