import { cn } from '@/lib/utils';
import type { LeadQuality, LeadStatus } from '@/types';

type BadgeVariant = LeadQuality | LeadStatus | 'admin' | 'setter' | 'default';

const VARIANT_CLASSES: Record<BadgeVariant, string> = {
  hot:            'badge-hot',
  warm:           'badge-warm',
  cold:           'badge-cold',
  client:         'badge-client',
  lost:           'badge-lost',
  in_progress:    'badge-in_progress',
  to_follow_up:   'badge-to_follow_up',
  to_follow_up_2: 'badge-to_follow_up_2',
  appointment:    'badge-appointment',
  r2:             'badge-r2',
  admin:          'badge-purple',
  setter:         'badge bg-gray-100 text-gray-700',
  default:        'badge bg-gray-100 text-gray-700',
};

const LABELS: Record<BadgeVariant, string> = {
  hot:            'Chaud',
  warm:           'Tiède',
  cold:           'Froid',
  client:         'Client',
  lost:           'Perdu',
  in_progress:    'En cours',
  to_follow_up:   'À relancer',
  to_follow_up_2: 'À relancer 2',
  appointment:    'RDV pris',
  r2:             'R2 pris',
  admin:          'Admin',
  setter:         'Setter',
  default:        '',
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
