'use client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DndContext, DragEndEvent, closestCenter } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, Phone, Building } from 'lucide-react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { leadsApi } from '@/lib/api';
import Badge from '@/components/ui/Badge';
import type { Lead, LeadStatus } from '@/types';

const COLUMNS: { id: LeadStatus; label: string; color: string }[] = [
  { id: 'in_progress', label: 'En cours', color: 'border-t-yellow-400' },
  { id: 'client',      label: 'Clients',  color: 'border-t-green-500'  },
  { id: 'lost',        label: 'Perdu',    color: 'border-t-gray-400'   },
];

function LeadCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: lead.id,
    data: { status: lead.status },
  });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.4 : 1 }}
      className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm hover:shadow-md transition-shadow cursor-pointer"
      onClick={() => router.push(`/leads/${lead.id}`)}
    >
      <div className="flex items-start gap-2">
        <button
          {...attributes} {...listeners}
          className="mt-0.5 text-gray-300 hover:text-gray-400 cursor-grab active:cursor-grabbing"
          onClick={(e) => e.stopPropagation()}
        >
          <GripVertical className="w-4 h-4" />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-gray-900 truncate">{lead.first_name} {lead.last_name}</p>
          {lead.company && (
            <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5 truncate">
              <Building className="w-3 h-3 flex-shrink-0" />{lead.company}
            </p>
          )}
          {lead.phone && (
            <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
              <Phone className="w-3 h-3 flex-shrink-0" />{lead.phone}
            </p>
          )}
          <div className="flex items-center gap-1 mt-2">
            {lead.lead_quality && <Badge variant={lead.lead_quality} />}
            {lead.called && <span className="badge bg-green-100 text-green-700 text-[10px]">Appelé</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

function Column({ status, leads, label, colorClass }: { status: LeadStatus; leads: Lead[]; label: string; colorClass: string }) {
  const { setNodeRef } = useSortable({ id: status, data: { isColumn: true } });
  return (
    <div ref={setNodeRef} className={`card flex flex-col min-h-96 border-t-4 ${colorClass}`} style={{ minWidth: 260 }}>
      <div className="p-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{label}</h3>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">{leads.length}</span>
      </div>
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[70vh]">
        <SortableContext items={leads.map((l) => l.id)} strategy={verticalListSortingStrategy}>
          {leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)}
        </SortableContext>
        {leads.length === 0 && (
          <div className="flex items-center justify-center h-24 text-gray-300 text-xs">Aucun lead</div>
        )}
      </div>
    </div>
  );
}

export default function PipelineBoard() {
  const qc = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['leads-pipeline'],
    queryFn:  () => leadsApi.getAll({ limit: 200 }).then((r) => r.data.data as Lead[]),
  });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      leadsApi.update(id, { status }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => toast.error('Erreur lors du déplacement'),
  });

  const leads = data ?? [];
  const getColumn = (status: LeadStatus) => leads.filter((l) => l.status === status);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;
    const leadId    = active.id as string;
    const overId    = over.id as string;
    const newStatus = COLUMNS.find((c) => c.id === overId)?.id ?? leads.find((l) => l.id === overId)?.status;
    if (newStatus && newStatus !== leads.find((l) => l.id === leadId)?.status) {
      mutation.mutate({ id: leadId, status: newStatus });
    }
  };

  return (
    <DndContext collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4">
        {COLUMNS.map((col) => (
          <Column key={col.id} status={col.id} label={col.label} colorClass={col.color} leads={getColumn(col.id)} />
        ))}
      </div>
    </DndContext>
  );
}
