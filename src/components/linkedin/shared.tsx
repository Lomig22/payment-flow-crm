import type { LinkedinStatus } from '@/types';

// Petites briques communes à la page /linkedin

export const STATUS_BADGE: Record<string, string> = {
  to_invite:   'bg-gray-100 text-gray-700',
  invited:     'bg-blue-100 text-blue-700',
  expired:     'bg-gray-200 text-gray-500',
  connected:   'bg-sky-100 text-sky-700',
  to_validate: 'bg-amber-100 text-amber-800',
  ready:       'bg-amber-50 text-amber-700',
  first_sent:  'bg-green-100 text-green-700',
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i + 1}_sent`, 'bg-teal-100 text-teal-700'])),   // R1 … R16
  no_reply:    'bg-gray-200 text-gray-600',
  to_resume:   'bg-emerald-200 text-emerald-900',
  dnc:         'bg-red-50 text-red-600',
  failed:      'bg-red-100 text-red-700',
};

export const VARIANT_BADGE: Record<string, string> = {
  A: 'bg-teal-600 text-white', B: 'bg-amber-500 text-white', C: 'bg-violet-600 text-white',
};

export const fmtTime = (iso: string | null | undefined) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const fullName = (l: { first_name: string | null; last_name: string | null }) =>
  `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim() || 'Sans nom';

export const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)} %` : '—');

export const apiError = (e: any) => e?.response?.data?.message ?? 'Erreur';
