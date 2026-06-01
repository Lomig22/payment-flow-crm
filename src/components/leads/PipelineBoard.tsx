'use client';
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  useDroppable, useDraggable,
  MouseSensor, TouchSensor, useSensor, useSensors,
  pointerWithin,
} from '@dnd-kit/core';
import { Phone, Building } from 'lucide-react';
import { useRouter } from 'next/navigation';
import toast from 'react-hot-toast';
import { leadsApi } from '@/lib/api';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import type { Lead, LeadStatus } from '@/types';

const COLUMNS: { id: LeadStatus; label: string; topColor: string; hoverBg: string; ringColor: string }[] = [
  { id: 'in_progress', label: 'En cours', topColor: 'border-t-yellow-400', hoverBg: 'bg-yellow-50/60',  ringColor: 'ring-yellow-300' },
  { id: 'client',      label: 'Clients',  topColor: 'border-t-green-500',  hoverBg: 'bg-green-50/60',   ringColor: 'ring-green-400'  },
  { id: 'lost',        label: 'Perdu',    topColor: 'border-t-gray-400',   hoverBg: 'bg-gray-100/60',   ringColor: 'ring-gray-300'   },
];

/* ── Card ─────────────────────────────────────────────────────────── */
function LeadCardInner({ lead }: { lead: Lead }) {
  return (
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-gray-900 break-words">
        {lead.first_name} {lead.last_name}
      </p>
      {lead.company && (
        <p className="text-xs text-gray-500 flex items-start gap-1 mt-0.5 break-words">
          <Building className="w-3 h-3 flex-shrink-0 text-gray-400 mt-0.5" />
          <span>{lead.company}</span>
        </p>
      )}
      {lead.phone && (
        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
          <Phone className="w-3 h-3 flex-shrink-0" />
          {lead.phone}
        </p>
      )}
      <div className="flex items-center gap-1 mt-2 flex-wrap">
        {lead.lead_quality && <Badge variant={lead.lead_quality} />}
        {lead.called && (
          <span className="badge bg-green-100 text-green-700 text-[10px]">Appelé</span>
        )}
      </div>
    </div>
  );
}

function DraggableCard({ lead }: { lead: Lead }) {
  const router = useRouter();
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: lead.id,
    data: { lead },
  });

  return (
    <div
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      style={{ opacity: isDragging ? 0 : 1, touchAction: 'none' }}
      className="bg-white rounded-lg border border-gray-200 p-3 shadow-sm
                 hover:shadow-md hover:border-indigo-200 transition-all
                 cursor-grab active:cursor-grabbing select-none"
      onClick={() => { if (!isDragging) router.push(`/leads/${lead.id}`); }}
    >
      <LeadCardInner lead={lead} />
    </div>
  );
}

/* Floating card shown while dragging */
function OverlayCard({ lead }: { lead: Lead }) {
  return (
    <div
      className="bg-white rounded-lg border-2 border-indigo-400 p-3 shadow-2xl
                 rotate-2 scale-105 cursor-grabbing select-none"
      style={{ width: 272 }}
    >
      <LeadCardInner lead={lead} />
    </div>
  );
}

/* ── Column ───────────────────────────────────────────────────────── */
function Column({
  col, leads, isTargeted,
}: {
  col: typeof COLUMNS[number];
  leads: Lead[];
  isTargeted: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const active = isOver && isTargeted;

  return (
    <div
      ref={setNodeRef}
      className={`card flex flex-col border-t-4 ${col.topColor} transition-colors duration-150
        ${active ? col.hoverBg : ''}
      `}
      style={{ minHeight: 420 }}
    >
      {/* Header */}
      <div className="p-3 border-b border-gray-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-800">{col.label}</h3>
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
          {leads.length}
        </span>
      </div>

      {/* Cards */}
      <div
        className={`flex-1 p-2 space-y-2 overflow-y-auto max-h-[72vh]
          transition-all duration-150
          ${active ? `ring-2 ring-inset ${col.ringColor}` : ''}
        `}
      >
        {leads.map((lead) => <DraggableCard key={lead.id} lead={lead} />)}

        {leads.length === 0 && (
          <div
            className={`flex items-center justify-center h-24 rounded-lg border-2 border-dashed
              transition-colors text-xs
              ${active
                ? 'border-indigo-300 text-indigo-400 bg-indigo-50/40'
                : 'border-gray-200 text-gray-300'
              }
            `}
          >
            {active ? 'Déposer ici' : 'Aucun lead'}
          </div>
        )}
      </div>
    </div>
  );
}

/* ── Board ────────────────────────────────────────────────────────── */
export default function PipelineBoard() {
  const qc = useQueryClient();
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, LeadStatus>>({});

  // 8 px distance before drag activates → clicks still work normally
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const { data, isLoading } = useQuery({
    queryKey: ['leads-pipeline'],
    queryFn:  () => leadsApi.getAll({ limit: 200 }).then((r) => r.data.data as Lead[]),
  });

  const mutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: LeadStatus }) =>
      leadsApi.update(id, { status }).then((r) => r.data),
    onSuccess: (_, { id }) => {
      setOptimistic((p) => { const n = { ...p }; delete n[id]; return n; });
      qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (_, { id }) => {
      setOptimistic((p) => { const n = { ...p }; delete n[id]; return n; });
      toast.error('Erreur lors du déplacement');
    },
  });

  const rawLeads = data ?? [];
  const leads = rawLeads.map((l) =>
    optimistic[l.id] ? { ...l, status: optimistic[l.id] } : l
  );
  const getColumn = (s: LeadStatus) => leads.filter((l) => l.status === s);

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveLead(active.data.current?.lead ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveLead(null);
    if (!over) return;
    const leadId    = active.id as string;
    const newStatus = over.id as LeadStatus;
    if (!COLUMNS.find((c) => c.id === newStatus)) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === newStatus) return;
    setOptimistic((p) => ({ ...p, [leadId]: newStatus }));
    mutation.mutate({ id: leadId, status: newStatus });
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={pointerWithin}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="grid pb-4" style={{ gridTemplateColumns: `repeat(${COLUMNS.length}, 1fr)`, gap: '1rem' }}>
        {COLUMNS.map((col) => (
          <Column
            key={col.id}
            col={col}
            leads={getColumn(col.id)}
            isTargeted={activeLead !== null && activeLead.status !== col.id}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
        {activeLead ? <OverlayCard lead={activeLead} /> : null}
      </DragOverlay>
    </DndContext>
  );
}
