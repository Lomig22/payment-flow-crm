'use client';
import { useState, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  DndContext, DragEndEvent, DragStartEvent, DragOverlay,
  useDroppable, useDraggable,
  MouseSensor, TouchSensor, useSensor, useSensors,
  type CollisionDetection,
} from '@dnd-kit/core';
import { Phone, Building, Star, ExternalLink } from 'lucide-react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import toast from 'react-hot-toast';
import { leadsApi, qualiopiLeadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { DmAccountBar, DmAccountTag, CopyM1Button, FollowBackButtons, useIgHandle, useFollowClick } from '@/components/leads/DmAccount';
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
  { id: 'not_qualified',  label: 'Non qualifié', topColor: 'border-t-stone-500',   hoverBg: 'bg-stone-100/60',  ringColor: 'ring-stone-300'   },
  { id: 'lost',           label: 'Perdu',        topColor: 'border-t-gray-400',    hoverBg: 'bg-gray-100/60',   ringColor: 'ring-gray-300'    },
];

// Tri d'une colonne, choisi dans son en-tête et mémorisé par navigateur :
//   entered      → derniers arrivés dans la colonne en haut (défaut)
//   updated_desc → dernière mise à jour : du plus récent au plus ancien
//   updated_asc  → dernière mise à jour : du plus ancien au plus récent
type ColSort = 'entered' | 'updated_desc' | 'updated_asc';
const COL_SORT_LABELS: Record<ColSort, string> = {
  entered:      'Derniers arrivés',
  updated_desc: 'Mis à jour : récent → ancien',
  updated_asc:  'Mis à jour : ancien → récent',
};

const shortDateTime = (iso?: string) =>
  iso ? new Date(iso).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

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

  // @username cliquable (profil ou DM selon l'étape, cf. useIgHandle), nouvel onglet.
  // stopPropagation sur mousedown/touchstart : ne démarre pas un drag dnd-kit
  // (MouseSensor/TouchSensor) ni l'ouverture de la fiche lead (onClick de la carte).
  const igHandle = useIgHandle();
  const ig = isSocial && lead.instagram_username ? igHandle(lead) : null;

  return (
    <div className="flex-1 min-w-0">
      {ig ? (
        <span className="inline-flex items-center gap-1">
        <a
          href={ig.href}
          target="_blank"
          rel="noopener noreferrer"
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onClick={ig.onClick}
          className="text-sm font-semibold text-gray-900 break-words hover:text-pink-600 hover:underline inline-flex items-center gap-1"
          title={ig.title}
        >
          {displayName}
          <ExternalLink className="w-3 h-3 flex-shrink-0 text-gray-300" />
        </a>
        <CopyM1Button lead={lead} />
        </span>
      ) : (
        <p className="text-sm font-semibold text-gray-900 break-words">{displayName}</p>
      )}
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
      {isSocial && <DmAccountTag accountId={lead.last_dm_account_id} />}
      {isSocial && <FollowBackButtons lead={lead} compact />}
      {lead.updated_at && (
        <p className="text-[10px] text-gray-300 mt-1" title="Dernière mise à jour du lead">maj {shortDateTime(lead.updated_at)}</p>
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
  col, leads, isTargeted, detailBase, isQualiopi, sort, onSortChange,
}: {
  col: typeof COLUMNS[number];
  leads: BoardLead[];
  isTargeted: boolean;
  detailBase: string;
  isQualiopi?: boolean;
  sort: ColSort;
  onSortChange: (s: ColSort) => void;
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
      <div className="p-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">{col.label}</h3>
          <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
            {leads.length}
          </span>
        </div>
        <select
          value={sort}
          onChange={(e) => onSortChange(e.target.value as ColSort)}
          title="Ordre des cartes de cette colonne"
          className={`mt-1.5 w-full text-[11px] rounded-md border px-1.5 py-0.5 bg-white cursor-pointer focus:outline-none focus:ring-1 focus:ring-primary-400
            ${sort === 'entered' ? 'border-gray-200 text-gray-400' : 'border-indigo-300 text-indigo-700 bg-indigo-50'}`}
        >
          {(Object.keys(COL_SORT_LABELS) as ColSort[]).map((k) => (
            <option key={k} value={k}>↕ {COL_SORT_LABELS[k]}</option>
          ))}
        </select>
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

// Piste « follow d'abord » (Instagram uniquement) : DM seulement après follow back.
const COLUMNS_FOLLOW: typeof COLUMNS = [
  { id: 'to_follow' as LeadStatus,        label: 'À follow',        topColor: 'border-t-sky-300',     hoverBg: 'bg-sky-50/60',     ringColor: 'ring-sky-200'     },
  { id: 'followed' as LeadStatus,         label: 'Follow envoyé',   topColor: 'border-t-sky-500',     hoverBg: 'bg-sky-50/60',     ringColor: 'ring-sky-300'     },
  { id: 'followed_back' as LeadStatus,    label: 'Follow back',     topColor: 'border-t-teal-500',    hoverBg: 'bg-teal-50/60',    ringColor: 'ring-teal-300'    },
];

const COLUMNS_DM: typeof COLUMNS = [
  { id: 'lead' as LeadStatus,            label: 'Lead',            topColor: 'border-t-gray-300',    hoverBg: 'bg-gray-50/60',    ringColor: 'ring-gray-200'    },
  { id: 'not_qualified' as LeadStatus,    label: 'Non qualifié',    topColor: 'border-t-stone-500',   hoverBg: 'bg-stone-100/60',  ringColor: 'ring-stone-300'   },
  { id: 'm1' as LeadStatus,               label: 'M1 envoyé',       topColor: 'border-t-blue-300',    hoverBg: 'bg-blue-50/60',    ringColor: 'ring-blue-200'    },
  { id: 'r1' as LeadStatus,               label: 'R1',              topColor: 'border-t-indigo-400',  hoverBg: 'bg-indigo-50/60',  ringColor: 'ring-indigo-300'  },
  { id: 'r2' as LeadStatus,               label: 'R2',              topColor: 'border-t-violet-400',  hoverBg: 'bg-violet-50/60',  ringColor: 'ring-violet-300'  },
  { id: 'reponse' as LeadStatus,          label: 'Réponse',         topColor: 'border-t-yellow-400',  hoverBg: 'bg-yellow-50/60',  ringColor: 'ring-yellow-300'  },
  { id: 'a_relancer' as LeadStatus,       label: 'À relancer',      topColor: 'border-t-orange-400',  hoverBg: 'bg-orange-50/60',  ringColor: 'ring-orange-300'  },
  { id: 'audit_a_envoyer' as LeadStatus,  label: 'Audit à envoyer', topColor: 'border-t-pink-400',    hoverBg: 'bg-pink-50/60',    ringColor: 'ring-pink-300'    },
  { id: 'audit_envoye' as LeadStatus,     label: 'Audit envoyé',    topColor: 'border-t-rose-400',    hoverBg: 'bg-rose-50/60',    ringColor: 'ring-rose-300'    },
  { id: 'rdv' as LeadStatus,              label: 'RDV',             topColor: 'border-t-green-500',   hoverBg: 'bg-green-50/60',   ringColor: 'ring-green-400'   },
];

const COLUMNS_INSTAGRAM = [...COLUMNS_FOLLOW, ...COLUMNS_DM];
const COLUMNS_FACEBOOK  = COLUMNS_DM;

/* ── Board ────────────────────────────────────────────────────────── */
interface PipelineBoardProps { source?: 'instagram' | 'cold_call' | 'facebook' | 'sea_ads'; variant?: 'qualiopi' }

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
  const [region,   setRegion]   = useState(sp.get('region') ?? '');
  useEffect(() => {
    const p = new URLSearchParams();
    if (setterId) p.set('setter', setterId);
    if (niche)    p.set('niche',  niche);
    if (region)   p.set('region', region);
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [setterId, niche, region, pathname, router]);

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
  const followClick = useFollowClick();

  // Tri par colonne, mémorisé par pipeline dans le navigateur
  const sortStorageKey = `pf_pipeline_sort:${variant ?? source ?? 'all'}`;
  const [colSort, setColSort] = useState<Record<string, ColSort>>({});
  useEffect(() => {
    try { setColSort(JSON.parse(localStorage.getItem(sortStorageKey) ?? '{}')); } catch { setColSort({}); }
  }, [sortStorageKey]);
  const changeColSort = (colId: string, mode: ColSort) =>
    setColSort((prev) => {
      const next = { ...prev, [colId]: mode };
      try { localStorage.setItem(sortStorageKey, JSON.stringify(next)); } catch { /* stockage indisponible */ }
      return next;
    });

  // Qualiopi et SEA/ADS suivent le funnel cold call (mêmes statuts).
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
    // Toujours re-lire le serveur en (re)arrivant sur la page : le staleTime
    // global (60 s) resservait un cache d'avant le dernier drag → les cartes
    // semblaient revenues en arrière après un aller-retour rapide.
    staleTime: 0,
    refetchOnMount: 'always',
  });

  const mutation = useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<BoardLead> }) =>
      (api as any).update(id, updates).then((r: any) => r.data),
    // Une micro-coupure réseau ne doit pas perdre un déplacement : on renvoie
    // la requête jusqu'à 3 fois. networkMode 'always' = tenter tout de suite
    // même si le navigateur se croit hors-ligne (sinon la mutation reste en
    // pause et se perd si on quitte la page).
    retry: 2,
    retryDelay: (attempt) => 500 * 2 ** attempt,
    networkMode: 'always',
    onSuccess: (_, { id, updates }) => {
      qc.setQueryData<BoardLead[]>(queryKey, (old) =>
        old?.map((l) => (l.id === id ? { ...l, ...updates } : l)) ?? old
      );
      setOptimistic((p) => { const n = { ...p }; delete n[id]; return n; });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['qualiopi-leads'] });
      // Invalide aussi les listes par pôle (leads-cold-call, leads-instagram,
      // leads-facebook, leads-cc-counts…) : leur clé ne commence pas par
      // ['leads'] et elles resservaient 60 s de cache périmé après un drag.
      qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('leads-'),
      });
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
  const leadRegion = (l: BoardLead) => (l.region ?? '').trim();
  const regionOptions = Array.from(new Set(rawLeads.map(leadRegion).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, 'fr'));
  if (region && !regionOptions.includes(region)) regionOptions.unshift(region);
  const leads: BoardLead[] = rawLeads
    .filter((l) => !niche || leadNiche(l) === niche)
    .filter((l) => !region || leadRegion(l) === region)
    .map((l) => (optimistic[l.id]
      // Timestamp optimiste : la carte déposée remonte en haut de sa colonne
      // sans attendre la réponse serveur.
      ? { ...l, status: optimistic[l.id], status_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() }
      : l));
  // Dans chaque colonne, le lead entré le plus récemment apparaît en haut
  // (status_changed_at maintenu par trigger SQL ; fallback updated_at/created_at).
  const statusTime = (l: BoardLead) =>
    new Date(l.status_changed_at ?? l.updated_at ?? l.created_at).getTime();
  const updatedTime = (l: BoardLead) => new Date(l.updated_at ?? l.created_at).getTime();
  const getColumn = (s: LeadStatus) => {
    const mode = colSort[s] ?? 'entered';
    const cards = leads.filter((l) => l.status === s);
    if (mode === 'updated_asc')  return cards.sort((a, b) => updatedTime(a) - updatedTime(b));
    if (mode === 'updated_desc') return cards.sort((a, b) => updatedTime(b) - updatedTime(a));
    return cards.sort((a, b) => statusTime(b) - statusTime(a));
  };

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

    // « À follow » → « Follow envoyé » = un follow : il passe par la route qui
    // applique le quota quotidien et le rattache au compte d'envoi.
    if (lead.status === 'to_follow' && newStatus === 'followed') {
      followClick(lead);
      return;
    }

    // status_changed_at est posé par le trigger SQL côté serveur ; on le met
    // aussi dans updates pour que le cache local (merge onSuccess) garde la
    // carte en haut de colonne sans refetch. La route PUT ignore ce champ.
    const updates: Partial<BoardLead> = { status: newStatus, status_changed_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    if (source === 'cold_call' || source === 'sea_ads' || isQualiopi) {
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
      {(source === 'instagram' || source === 'facebook') && <DmAccountBar />}

      {/* Filtres : setter (admin) + activité */}
      {((isAdmin && setters) || nicheOptions.length > 0 || regionOptions.length > 0) && (
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
          {regionOptions.length > 0 && (
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value)}
              className="select w-auto text-sm"
            >
              <option value="">Toutes régions</option>
              {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
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
            sort={colSort[col.id] ?? 'entered'}
            onSortChange={(mode) => changeColSort(col.id, mode)}
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
