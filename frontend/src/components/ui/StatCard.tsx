import { LucideIcon, TrendingUp, TrendingDown } from 'lucide-react';
import { cn } from '@/lib/utils';

interface StatCardProps {
  title:   string;
  value:   string | number;
  icon:    LucideIcon;
  suffix?: string;
  trend?:  { value: number; isPositive: boolean; label?: string };
  color?:  'purple' | 'green' | 'blue' | 'orange' | 'red' | 'gray';
}

const COLOR_MAP = {
  purple: { bg: 'bg-primary-50', icon: 'bg-primary-100 text-primary-600' },
  green:  { bg: 'bg-green-50',   icon: 'bg-green-100 text-green-600' },
  blue:   { bg: 'bg-blue-50',    icon: 'bg-blue-100 text-blue-600' },
  orange: { bg: 'bg-orange-50',  icon: 'bg-orange-100 text-orange-600' },
  red:    { bg: 'bg-red-50',     icon: 'bg-red-100 text-red-600' },
  gray:   { bg: 'bg-gray-50',    icon: 'bg-gray-100 text-gray-600' },
};

export default function StatCard({ title, value, icon: Icon, suffix, trend, color = 'purple' }: StatCardProps) {
  const colors = COLOR_MAP[color];

  return (
    <div className="card p-5 flex items-start gap-4">
      <div className={cn('w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0', colors.icon)}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm text-gray-500 font-medium truncate">{title}</p>
        <p className="text-2xl font-bold text-gray-900 mt-0.5">
          {value}{suffix && <span className="text-base font-medium text-gray-500 ml-1">{suffix}</span>}
        </p>
        {trend && (
          <div className={cn(
            'flex items-center gap-1 mt-1 text-xs font-medium',
            trend.isPositive ? 'text-green-600' : 'text-red-500'
          )}>
            {trend.isPositive
              ? <TrendingUp className="w-3 h-3" />
              : <TrendingDown className="w-3 h-3" />
            }
            {Math.abs(trend.value)}% {trend.label ?? ''}
          </div>
        )}
      </div>
    </div>
  );
}
