'use client';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, RefreshCw, ChevronRight } from 'lucide-react';
import { notificationsApi } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';
import { getInitials, timeAgo, FIELD_LABELS, STATUS_LABELS } from '@/lib/utils';

function formatActivity(entry: any): string {
  if (entry.action_note) return entry.action_note;
  const field = FIELD_LABELS[entry.field_changed] ?? entry.field_changed;
  if (entry.field_changed === 'status') {
    return `Statut → ${STATUS_LABELS[entry.new_value] ?? entry.new_value}`;
  }
  if (['called','appointment_taken','appointment_honored','quote_sent','r2_planned','r3_planned'].includes(entry.field_changed)) {
    return entry.new_value === 'true' ? field : `${field} annulé`;
  }
  if (entry.field_changed) return `${field} modifié`;
  return 'Activité';
}

function getLeadName(entry: any): string {
  const lead = entry.leads;
  if (!lead) return 'Lead supprimé';
  return lead.company || `${lead.first_name} ${lead.last_name}`;
}

export default function NotificationsPage() {
  const router = useRouter();
  const qc     = useQueryClient();

  const { data: notifications = [], isLoading } = useQuery({
    queryKey: ['notifications-all'],
    queryFn:  () => notificationsApi.getAll(100).then((r) => r.data as any[]),
    staleTime: 30_000,
  });

  return (
    <div className="max-w-3xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="w-5 h-5 text-gray-500" />
          <h2 className="text-base font-semibold text-gray-900">Toutes les notifications</h2>
          {notifications.length > 0 && (
            <span className="text-xs text-gray-400">· {notifications.length}</span>
          )}
        </div>
        <button
          onClick={() => qc.invalidateQueries({ queryKey: ['notifications-all'] })}
          className="btn-secondary btn-sm"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Rafraîchir
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-48"><Spinner /></div>
        ) : notifications.length === 0 ? (
          <div className="px-4 py-12 text-center text-sm text-gray-400">
            Aucune activité récente
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {notifications.map((n: any) => (
              <button
                key={n.id}
                onClick={() => router.push(`/leads/${n.lead_id}`)}
                className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
              >
                <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                  <span className="text-[10px] font-bold">
                    {getInitials(n.leads?.first_name ?? '?', n.leads?.last_name ?? '')}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900 truncate">{getLeadName(n)}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{formatActivity(n)}</p>
                </div>
                <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">{timeAgo(n.created_at)}</span>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 mt-0.5" />
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
