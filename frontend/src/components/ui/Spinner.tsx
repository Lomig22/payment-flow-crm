import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

export default function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn('animate-spin text-primary-600', className ?? 'w-6 h-6')} />;
}
