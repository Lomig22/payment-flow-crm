import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const formatDate = (date: string | Date) =>
  format(new Date(date), 'dd MMM yyyy', { locale: fr });

export const formatDateTime = (date: string | Date) =>
  format(new Date(date), 'dd MMM yyyy à HH:mm', { locale: fr });

export const timeAgo = (date: string | Date) =>
  formatDistanceToNow(new Date(date), { addSuffix: true, locale: fr });

export const getInitials = (firstName: string, lastName: string) =>
  `${firstName?.[0] ?? ''}${lastName?.[0] ?? ''}`.toUpperCase();

export const QUALITY_LABELS: Record<string, string> = {
  hot:  'Chaud',
  warm: 'Tiède',
  cold: 'Froid',
};

export const STATUS_LABELS: Record<string, string> = {
  in_progress:    'En cours',
  to_follow_up:   'À relancer',
  to_follow_up_2: 'À relancer 2',
  appointment:    'RDV pris',
  r2:             'R2 pris',
  client:         'Client',
  not_qualified:  'Non qualifié',
  lost:           'Perdu',
};

export const ACTION_LABELS: Record<string, string> = {
  to_call:     'À appeler',
  callback:    'Rappel',
  follow_up:   'Suivi',
  negotiation: 'Négociation',
  no_action:   'Aucune action',
};

export const FIELD_LABELS: Record<string, string> = {
  li_status:           'Séquence LinkedIn',
  called:              'Appelé',
  action_in_progress:  'Action en cours',
  lead_quality:        'Qualité du lead',
  need_identified:     'Besoin identifié',
  setter_id:           'Setter assigné',
  appointment_taken:   'RDV pris',
  appointment_honored: 'RDV honoré',
  quote_sent:          'Devis envoyé',
  r2_planned:          'R2 planifié',
  r3_planned:          'R3 planifié',
  status:              'Statut',
  notes:               'Notes',
  first_name:          'Prénom',
  last_name:           'Nom',
  company:             'Société',
  phone:               'Téléphone',
  email:               'Email',
  location:            'Localisation',
};

// Lien officiel Meta qui ouvre directement la conversation DM avec le compte
// (appli Instagram sur mobile, instagram.com/direct sur desktop).
export const igDmUrl = (username: string) =>
  `https://ig.me/m/${encodeURIComponent(username.trim().replace(/^@/, ''))}`;

// Filet de sécurité des légendes : un émoji sorti en échappement littéral
// (« 💬 », bug du compilateur de Next.js en prod) est remis en caractère.
export function fixEscapedEmoji(text: string): string;
export function fixEscapedEmoji(text: string | null): string | null;
export function fixEscapedEmoji(text: string | null): string | null {
  if (!text || !text.includes('\\u')) return text;
  return text
    .replace(/\\u\{([0-9a-fA-F]{4,6})\}/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/\\u([dD][89abAB][0-9a-fA-F]{2})\\u([dD][c-fC-F][0-9a-fA-F]{2})/g,
      (_, hi, lo) => String.fromCharCode(parseInt(hi, 16), parseInt(lo, 16)));
}
