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
  in_progress: 'En cours',
  client:      'Client',
  lost:        'Perdu',
};

export const ACTION_LABELS: Record<string, string> = {
  to_call:     'À appeler',
  callback:    'Rappel',
  follow_up:   'Suivi',
  negotiation: 'Négociation',
  no_action:   'Aucune action',
};

export const FIELD_LABELS: Record<string, string> = {
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
