import { cn } from '@/lib/utils';
import type { LeadQuality, LeadStatus } from '@/types';

type BadgeVariant = LeadQuality | LeadStatus | 'admin' | 'setter' | 'default';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  hot:             'badge-hot',
  warm:            'badge-warm',
  cold:            'badge-cold',
  client:          'badge-client',
  lost:            'badge-lost',
  in_progress:     'badge-in_progress',
  to_follow_up:    'badge-to_follow_up',
  to_follow_up_2:  'badge-to_follow_up_2',
  appointment:     'badge-appointment',
  r2:              'badge-r2',
  // Instagram/Facebook funnel
  lead:            'badge bg-gray-100 text-gray-600',
  m1:              'badge bg-blue-100 text-blue-700',
  r1:              'badge bg-indigo-100 text-indigo-700',
  reponse:         'badge bg-yellow-100 text-yellow-700',
  a_relancer:      'badge bg-orange-100 text-orange-700',
  audit_a_envoyer: 'badge bg-pink-100 text-pink-700',
  audit_envoye:    'badge bg-rose-100 text-rose-700',
  rdv:             'badge bg-green-100 text-green-700',
  admin:           'badge-purple',
  setter:          'badge bg-gray-100 text-gray-700',
  default:         'badge bg-gray-100 text-gray-700',
};

const LABELS: Record<BadgeVariant, string> = {
  hot:             'Chaud',
  warm:            'Tiède',
  cold:            'Froid',
  client:          'Client',
  lost:            'Perdu',
  in_progress:     'En cours',
  to_follow_up:    'À relancer',
  to_follow_up_2:  'À relancer 2',
  appointment:     'RDV pris',
  r2:              'R2 pris',
  // Instagram/Facebook funnel
  lead:            'Lead',
  m1:              'M1 envoyé',
  r1:              'R1',
  reponse:         'Réponse',
  a_relancer:      'À relancer',
  audit_a_envoyer: 'Audit à envoyer',
  audit_envoye:    'Audit envoyé',
  rdv:             'RDV',
  admin:           'Admin',
  setter:          'Setter',
  default:         '',
};

interface BadgeProps {
  variant:   BadgeVariant;
  children?: React.ReactNode;
  className?: string;
}

export default function Badge({ variant, children, className }: BadgeProps) {
  return (
    <span className={cn(VARIANT_CLASSES[variant] ?? VARIANT_CLASSES.default, className)}>
      {children ?? LABELS[variant]}
    </span>
  );
}
