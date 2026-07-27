'use client';
import { useState, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  useDroppable, useDraggable,
  MouseSensor, TouchSensor, useSensor, useSensors,
  type CollisionDetection,
} from '@dnd-kit/core';
import { Phone, Building, Star } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { leadsApi, qualiopiLeadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import type { Lead, LeadStatus } from '@/types';

// Le board accepte aussi bien un Lead que un QualiopiLead (champs proches mais
// pas identiques : dirigeant/activite vs first_name/niche). On reste souple.
type BoardLead = Lead & { dirigeant?: string; activite?: string };

// Detect the column whose horizontal center is closest to the pointer X.
// This is more predictable than pointerWithin: the card always lands in
// whichever column the cursor is most "inside" horizontally.
const closestColumnByX: CollisionDetection = ({ droppableContainers, pointerCoordinates }) => {
  if (!pointerCoordinates) return [];
  const px = pointerCoordinates.x;
  let best: { c: (typeof droppableContainers)[number]; dist: number } | null = null;
  for (const c of droppableContainers) {
    const rect = c.rect.current;
    if (!rect) continue;
    const centerX = rect.left + rect.width / 2;
    const dist = Math.abs(px - centerX);
    if (!best || dist < best.dist) best = { c, dist };
  }
  return best
    ? [{ id: best.c.id, data: { droppableContainer: best.c, value: best.dist } }]
    : [];
};

const COLUMNS: { id: LeadStatus; label: string; topColor: string; hoverBg: string; ringColor: string }[] = [
  { id: 'in_progress',    label: 'En cours',     topColor: 'border-t-yellow-400',  hoverBg: 'bg-yellow-50/60',  ringColor: 'ring-yellow-300'  },
  { id: 'to_follow_up',   label: 'À relancer',   topColor: 'border-t-orange-400',  hoverBg: 'bg-orange-50/60',  ringColor: 'ring-orange-300'  },
  { id: 'to_follow_up_2', label: 'À relancer 2', topColor: 'border-t-red-400',     hoverBg: 'bg-red-50/60',     ringColor: 'ring-red-300'     },
  { id: 'appointment',    label: 'RDV pris',     topColor: 'border-t-blue-400',    hoverBg: 'bg-blue-50/60',    ringColor: 'ring-blue-300'    },
  { id: 'r2',             label: 'R2 pris',      topColor: 'border-t-purple-400',  hoverBg: 'bg-purple-50/60',  ringColor: 'ring-purple-300'  },
  { id: 'client',         label: 'Client',       topColor: 'border-t-green-500',   hoverBg: 'bg-green-50/60',   ringColor: 'ring-green-400'   },
  { id: 'lost',           label: 'Perdu',        topColor: 'border-t-gray-400',    hoverBg: 'bg-gray-100/60',   ringColor: 'ring-gray-300'    },
];

/* ── Card ─────────────────────────────────────────────────────────── */
function LeadCardInner({ lead, isQualiopi }: { lead: BoardLead; isQualiopi?: boolean }) {
  const isSocial = lead.source === 'instagram' || lead.source === 'facebook';
  const displayName = isQualiopi
    ? (lead.dirigeant || lead.company || '—')
    : isSocial && lead.instagram_username
      ? `@${lead.instagram_username}`
      : `${lead.first_name} ${lead.last_name}`;
  const subtitle = isQualiopi
    ? (lead.dirigeant ? lead.company : undefined)
    : lead.company;
  const tagline = isQualiopi ? lead.activite : lead.niche;

  return (
    <div className="flex-1 min-w-0">
      <p className="text-sm font-semibold text-gray-900 break-words">{displayName}</p>
      {subtitle && (
        <p className="text-xs text-gray-500 flex items-start gap-1 mt-0.5 break-words">
          <Building className="w-3 h-3 flex-shrink-0 text-gray-400 mt-0.5" />
          <span>{subtitle}</span>
        </p>
      )}
      {lead.phone && (
        <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
          <Phone className="w-3 h-3 flex-shrink-0" />
          {lead.phone}
        </p>
      )}
      {lead.rating != null && (
        <p className="text-xs text-gray-500 flex items-center gap-1 mt-0.5">
          <Star className="w-3 h-3 flex-shrink-0 fill-amber-400 text-amber-400" />
          <span>{lead.rating}{lead.reviews != null && ` · ${lead.reviews} avis`}</span>
        </p>
      )}
      {tagline && (
        <p className="text-[10px] text-gray-400 mt-0.5">{tagline}</p>
      )}
      <div className="flex items-center gap-1 mt-2 flex-wrap">
        {lead.lead_quality && <Badge variant={lead.lead_quality} />}
        {lead.called && <span className="badge bg-green-100 text-green-700 text-[10px]">Appelé</span>}
        {lead.rdv_outcome === 'vendu' && <span className="badge bg-green-100 text-green-700 text-[10px]">Vendu</span>}
        {lead.rdv_outcome === 'no_show' && <span className="badge bg-red-100 text-red-600 text-[10px]">No Show</span>}
      </div>
    </div>
  );
}

function DraggableCard({ lead, detailBase, isQualiopi }: { lead: BoardLead; detailBase: string; isQualiopi?: boolean }) {
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
      onClick={() => { if (!isDragging) router.push(`${detailBase}/${lead.id}`); }}
    >
      <LeadCardInner lead={lead} isQualiopi={isQualiopi} />
    </div>
  );
}

/* Floating card shown while dragging */
function OverlayCard({ lead, isQualiopi }: { lead: BoardLead; isQualiopi?: boolean }) {
  return (
    <div
      className="bg-white rounded-lg border-2 border-indigo-400 p-3 shadow-2xl
                 cursor-grabbing select-none"
      style={{ width: 272 }}
    >
      <LeadCardInner lead={lead} isQualiopi={isQualiopi} />
    </div>
  );
}

/* ── Column ───────────────────────────────────────────────────────── */
function Column({
  col, leads, isTargeted, detailBase, isQualiopi,
}: {
  col: typeof COLUMNS[number];
  leads: BoardLead[];
  isTargeted: boolean;
  detailBase: string;
  isQualiopi?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: col.id });
  const active = isOver && isTargeted;

  return (
    <div
      ref={setNodeRef}
      className={`card flex flex-col border-t-4 ${col.topColor} transition-colors duration-150 flex-shrink-0
        ${active ? col.hoverBg : ''}
      `}
      style={{ minHeight: 420, width: 260 }}
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
        {leads.map((lead) => <DraggableCard key={lead.id} lead={lead} detailBase={detailBase} isQualiopi={isQualiopi} />)}

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

const COLUMNS_INSTAGRAM: typeof COLUMNS = [
  { id: 'lead' as LeadStatus,             label: 'Lead',            topColor: 'border-t-gray-300',    hoverBg: 'bg-gray-50/60',    ringColor: 'ring-gray-200'    },
  { id: 'm1' as LeadStatus,               label: 'M1 envoyé',       topColor: 'border-t-blue-300',    hoverBg: 'bg-blue-50/60',    ringColor: 'ring-blue-200'    },
  { id: 'r1' as LeadStatus,               label: 'R1',              topColor: 'border-t-indigo-400',  hoverBg: 'bg-indigo-50/60',  ringColor: 'ring-indigo-300'  },
  { id: 'r2' as LeadStatus,               label: 'R2',              topColor: 'border-t-violet-400',  hoverBg: 'bg-violet-50/60',  ringColor: 'ring-violet-300'  },
  { id: 'reponse' as LeadStatus,          label: 'Réponse',         topColor: 'border-t-yellow-400',  hoverBg: 'bg-yellow-50/60',  ringColor: 'ring-yellow-300'  },
  { id: 'a_relancer' as LeadStatus,       label: 'À relancer',      topColor: 'border-t-orange-400',  hoverBg: 'bg-orange-50/60',  ringColor: 'ring-orange-300'  },
  { id: 'audit_a_envoyer' as LeadStatus,  label: 'Audit à envoyer', topColor: 'border-t-pink-400',    hoverBg: 'bg-pink-50/60',    ringColor: 'ring-pink-300'    },
  { id: 'audit_envoye' as LeadStatus,     label: 'Audit envoyé',    topColor: 'border-t-rose-400',    hoverBg: 'bg-rose-50/60',    ringColor: 'ring-rose-300'    },
  { id: 'rdv' as LeadStatus,              label: 'RDV',             topColor: 'border-t-green-500',   hoverBg: 'bg-green-50/60',   ringColor: 'ring-green-400'   },
];

const COLUMNS_FACEBOOK = COLUMNS_INSTAGRAM;

/* ── Board ────────────────────────────────────────────────────────── */
interface PipelineBoardProps { source?: 'instagram' | 'cold_call' | 'facebook'; variant?: 'qualiopi' }

export default function PipelineBoard(props: PipelineBoardProps = {}) {
  // useSearchParams (filtre setter dans l'URL) impose une frontière Suspense
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8" /></div>}>
      <Board {...props} />
    </Suspense>
  );
}

function Board({ source, variant }: PipelineBoardProps) {
  const qc = useQueryClient();
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();
  const user     = useAuthStore((s) => s.user);
  const isAdmin  = user?.role === 'admin';

  // Filtres persistés dans l'URL : setter (admin) + activité
  const [setterId, setSetterId] = useState(sp.get('setter') ?? '');
  const [niche,    setNiche]    = useState(sp.get('niche')  ?? '');
  useEffect(() => {
    const p = new URLSearchParams();
    if (setterId) p.set('setter', setterId);
    if (niche)    p.set('niche',  niche);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [setterId, niche, pathname, router]);

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
    enabled:  isAdmin,
  });

  const isQualiopi = variant === 'qualiopi';
  const api = isQualiopi ? qualiopiLeadsApi : leadsApi;
  const detailBase = isQualiopi ? '/qualiopi' : '/leads';
  const queryKey = ['leads-pipeline', source, variant, setterId];
  const [activeLead, setActiveLead] = useState<BoardLead | null>(null);
  const [optimistic, setOptimistic] = useState<Record<string, LeadStatus>>({});

  // Qualiopi suit le funnel cold call (mêmes statuts).
  const columns = isQualiopi ? COLUMNS
    : source === 'instagram' ? COLUMNS_INSTAGRAM
    : source === 'facebook' ? COLUMNS_FACEBOOK
    : COLUMNS;

  // 8 px distance before drag activates → clicks still work normally
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );

  const { data, isLoading } = useQuery({
    queryKey,
    queryFn:  () => (api as any).getAll({
      limit: 2000,
      ...(source && !isQualiopi ? { source } : {}),
      ...(setterId ? { setter_id: setterId } : {}),
    }).then((r: any) => r.data.data as BoardLead[]),
  });

  const mutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<BoardLead> }) =>
      (api as any).update(id, updates).then((r: any) => r.data),
    onSuccess: (_, { id, updates }) => {
      qc.setQueryData<BoardLead[]>(queryKey, (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...updates } : l)) ?? old
      );
      setOptimistic((p) => { const n = { ...p }; delete n[id]; return n; });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['qualiopi-leads'] });
      // Le déplacement modifie l'activité agrégée → rafraîchir les dashboards.
      qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['leaderboard'] });
      qc.invalidateQueries({ queryKey: ['instagram-dashboard-stats'] });
      qc.invalidateQueries({ queryKey: ['qualiopi-dashboard-stats'] });
    },
    onError: (_, { id }) => {
      setOptimistic((p) => { const n = { ...p }; delete n[id]; return n; });
      toast.error('Erreur lors du déplacement');
    },
  });

  const rawLeads: BoardLead[] = (data as BoardLead[] | undefined) ?? [];
  // Activités présentes dans la vue (niche côté leads, activite côté Qualiopi)
  const leadNiche = (l: BoardLead) => ((isQualiopi ? l.activite : l.niche) ?? '').trim();
  const nicheOptions = Array.from(new Set(rawLeads.map(leadNiche).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  if (niche && !nicheOptions.includes(niche)) nicheOptions.unshift(niche);
  const leads: BoardLead[] = rawLeads
    .filter((l) => !niche || leadNiche(l) === niche)
    .map((l) => (optimistic[l.id] ? { ...l, status: optimistic[l.id] } : l));
  const getColumn = (s: LeadStatus) => leads.filter((l) => l.status === s);

  const handleDragStart = ({ active }: DragStartEvent) => {
    setActiveLead(active.data.current?.lead ?? null);
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setActiveLead(null);
    if (!over) return;
    const leadId    = active.id as string;
    const newStatus = over.id as LeadStatus;
    if (!columns.find((c) => c.id === newStatus)) return;
    const lead = leads.find((l) => l.id === leadId);
    if (!lead || lead.status === newStatus) return;

    const updates: Partial<BoardLead> = { status: newStatus };
    if (source === 'cold_call' || isQualiopi) {
      // Sortir un lead de « En cours » vers un autre statut signifie forcément
      // qu'on l'a appelé → on coche « Appelé » automatiquement.
      if (lead.status === 'in_progress' && !lead.called) updates.called = true;
      // Les colonnes « RDV pris » / « R2 pris » impliquent qu'un RDV a été pris
      // → on coche « RDV pris » pour que le dashboard reflète le pipeline.
      if ((newStatus === 'appointment' || newStatus === 'r2') && !lead.appointment_taken) {
        updates.appointment_taken = true;
      }
    }

    setOptimistic((p) => ({ ...p, [leadId]: newStatus }));
    mutation.mutate({ id: leadId, updates });
  };

  return (
    <div className="space-y-4">
      {/* Filtres : setter (admin) + activité */}
      {((isAdmin && setters) || nicheOptions.length > 0) && (
        <div className="flex flex-wrap items-center gap-3">
          {isAdmin && setters && (
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-500">Pipeline de :</label>
              <select
                value={setterId}
                onChange={(e) => setSetterId(e.target.value)}
                className="select w-auto text-sm"
              >
                <option value="">Tous les setters</option>
                {(setters as any[]).map((s) => (
                  <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                ))}
              </select>
            </div>
          )}
          {nicheOptions.length > 0 && (
            <select
              value={niche}
              onChange={(e) => setNiche(e.target.value)}
              className="select w-auto text-sm"
            >
              <option value="">Toutes activités</option>
              {nicheOptions.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Spinner className="w-8 h-8" />
        </div>
      ) : (
    <DndContext
      sensors={sensors}
      collisionDetection={closestColumnByX}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className="flex gap-4 pb-4 overflow-x-auto" style={{ minWidth: 'max-content' }}>
        {columns.map((col) => (
          <Column
            key={col.id}
            col={col}
            leads={getColumn(col.id)}
            isTargeted={activeLead !== null && activeLead.status !== col.id}
            detailBase={detailBase}
            isQualiopi={isQualiopi}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={{ duration: 150, easing: 'cubic-bezier(0.18,0.67,0.6,1.22)' }}>
        {activeLead ? <OverlayCard lead={activeLead} isQualiopi={isQualiopi} /> : null}
      </DragOverlay>
    </DndContext>
      )}
    </div>
  );
}
