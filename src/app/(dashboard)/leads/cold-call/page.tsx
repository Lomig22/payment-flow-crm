'use client';
import { useState, useCallback, useRef, useEffect, Suspense } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Search, Eye, RefreshCw, X, ChevronLeft, ChevronRight, Trash2, UserCheck, Phone, Plus, Star,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import LeadForm from '@/components/leads/LeadForm';
import DuplicatesBanner from '@/components/leads/DuplicatesBanner';
import { formatDate } from '@/lib/utils';
import type { Lead, LeadsFilters, LeadStatus, LeadQuality } from '@/types';

const CC_STATUS_LABELS: Record<string, string> = {
  in_progress: 'En cours', to_follow_up: 'À relancer', to_follow_up_2: 'À relancer 2',
  appointment: 'RDV pris', r2: 'R2 pris', client: 'Client', lost: 'Perdu',
};

const CC_TABS = [
  { label: 'Tous',          value: '' },
  { label: 'En cours',      value: 'in_progress' },
  { label: 'À relancer',    value: 'to_follow_up' },
  { label: 'À relancer 2',  value: 'to_follow_up_2' },
  { label: 'RDV pris',      value: 'appointment' },
  { label: 'R2 pris',       value: 'r2' },
  { label: 'Client',        value: 'client' },
  { label: 'Perdu',         value: 'lost' },
];

export default function ColdCallLeadsPage() {
  // useSearchParams impose une frontière Suspense sur une page pré-rendue
  return (
    <Suspense fallback={<div className="flex items-center justify-center h-48"><Spinner /></div>}>
      <ColdCallLeads />
    </Suspense>
  );
}

function ColdCallLeads() {
  const router   = useRouter();
  const pathname = usePathname();
  const sp       = useSearchParams();
  const qc      = useQueryClient();
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  // Filtres initialisés depuis l'URL : le retour depuis une fiche lead
  // (router.back) retombe sur la même vue filtrée
  const [activeTab,    setActiveTab]    = useState(sp.get('status') ?? '');
  const [filters,      setFilters]      = useState<LeadsFilters>({
    page:      Math.max(1, Number(sp.get('page') ?? 1) || 1),
    limit:     50,
    source:    'cold_call',
    status:    (sp.get('status')  ?? undefined) as LeadStatus | undefined,
    quality:   (sp.get('quality') ?? undefined) as LeadQuality | undefined,
    niche:     sp.get('niche')  ?? undefined,
    setter_id: sp.get('setter') ?? undefined,
    search:    sp.get('q')      ?? undefined,
  });
  const [search,       setSearch]       = useState(sp.get('q') ?? '');

  // Reflète chaque changement de filtre dans l'URL (replace, sans scroll)
  useEffect(() => {
    const p = new URLSearchParams();
    if (filters.status)    p.set('status',  String(filters.status));
    if (filters.quality)   p.set('quality', String(filters.quality));
    if (filters.niche)     p.set('niche',   filters.niche);
    if (filters.setter_id) p.set('setter',  filters.setter_id);
    if (filters.search)    p.set('q',       filters.search);
    if ((filters.page ?? 1) > 1) p.set('page', String(filters.page));
    const qs = p.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  }, [filters, pathname, router]);
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [bulkStatus,   setBulkStatus]   = useState('');
  const [bulkSetterId, setBulkSetterId] = useState('');
  const [createOpen,   setCreateOpen]   = useState(false);
  const selectAllRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useCallback((val: string) => {
    setSearch(val);
    setFilters((f) => ({ ...f, search: val || undefined, page: 1 }));
  }, []);

  const handleTabChange = (tab: string) => {
    setActiveTab(tab);
    setFilters((f) => ({ ...f, status: (tab || undefined) as LeadStatus | undefined, page: 1 }));
    setSelected(new Set());
  };

  // Counts per status (tab badges)
  const { data: countsData } = useQuery({
    queryKey: ['leads-cc-counts', filters.setter_id],
    queryFn: () => leadsApi.getAll({
      source: 'cold_call', count_only: true,
      ...(filters.setter_id ? { setter_id: filters.setter_id } : {}),
    } as LeadsFilters).then((r) => r.data.counts as Record<string, number> | undefined),
    staleTime: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['leads-cold-call', filters],
    queryFn:  () => leadsApi.getAll(filters).then((r) => r.data),
  });

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
    enabled:  isAdmin,
  });

  const { data: niches } = useQuery({
    queryKey: ['leads-cc-niches'],
    queryFn:  () => leadsApi.niches('cold_call').then((r) => r.data as string[]),
    staleTime: 60_000,
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      leadsApi.bulkStatus(ids, status),
    onSuccess: (_, { ids }) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} mis à jour`);
      setSelected(new Set()); setBulkStatus('');
      qc.invalidateQueries({ queryKey: ['leads-cold-call'] });
      qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: ({ ids, setterId }: { ids: string[]; setterId: string }) =>
      leadsApi.assign(ids, setterId),
    onSuccess: (_, { ids }) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} réassigné${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set()); setBulkSetterId('');
      qc.invalidateQueries({ queryKey: ['leads-cold-call'] });
      qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
    },
    onError: () => toast.error('Erreur lors de la réassignation'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => leadsApi.bulkDelete(ids),
    onSuccess: (_, ids) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['leads-cold-call'] });
      qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
      qc.invalidateQueries({ queryKey: ['leads-cc-counts'] });
      qc.invalidateQueries({ queryKey: ['leads-duplicates'] });
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const deleteMutation = useMutation({
    mutationFn: leadsApi.delete,
    onSuccess: () => {
      toast.success('Lead supprimé');
      qc.invalidateQueries({ queryKey: ['leads-cold-call'] });
      qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
      qc.invalidateQueries({ queryKey: ['leads-cc-counts'] });
      qc.invalidateQueries({ queryKey: ['leads-duplicates'] });
    },
  });

  const leads      = data?.data ?? [];
  const pagination = data?.pagination;
  const pageIds    = leads.map((l: Lead) => l.id);
  const allPageSelected  = pageIds.length > 0 && pageIds.every((id: string) => selected.has(id));
  const somePageSelected = pageIds.some((id: string) => selected.has(id)) && !allPageSelected;

  if (selectAllRef.current) selectAllRef.current.indeterminate = somePageSelected;

  const toggleSelectAll = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      allPageSelected ? pageIds.forEach((id: string) => next.delete(id)) : pageIds.forEach((id: string) => next.add(id));
      return next;
    });

  const toggleSelect = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const totalCount = countsData ? Object.values(countsData).reduce((a, b) => a + b, 0) : undefined;

  return (
    <div className="space-y-4">
      <DuplicatesBanner source="cold_call" label="Cold Call" />

      {/* Tabs */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex border-b border-gray-100 min-w-max">
            {CC_TABS.map((tab) => {
              const count = tab.value ? (countsData?.[tab.value] ?? 0) : (totalCount ?? 0);
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => handleTabChange(tab.value)}
                  className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5
                    ${isActive
                      ? 'border-blue-500 text-blue-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold
                      ${isActive ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={(e) => debouncedSearch(e.target.value)}
            placeholder="Rechercher nom, société, téléphone…" className="input pl-9 py-2 text-sm" />
          {search && (
            <button onClick={() => debouncedSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        <select className="select w-auto text-sm" value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as LeadStatus | '', page: 1 }))}>
          <option value="">Tous les statuts</option>
          {Object.entries(CC_STATUS_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>

        <select className="select w-auto text-sm" value={filters.quality ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, quality: e.target.value as LeadQuality | '', page: 1 }))}>
          <option value="">Toutes qualités</option>
          <option value="hot">Chaud</option>
          <option value="warm">Tiède</option>
          <option value="cold">Froid</option>
        </select>

        {niches && niches.length > 0 && (
          <select className="select w-auto text-sm" value={filters.niche ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, niche: e.target.value || undefined, page: 1 }))}>
            <option value="">Toutes activités</option>
            {niches.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        )}

        {isAdmin && setters && (
          <select className="select w-auto text-sm" value={filters.setter_id ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, setter_id: e.target.value || undefined, page: 1 }))}>
            <option value="">Tous les setters</option>
            {(setters as any[]).map((s) => (
              <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => qc.invalidateQueries({ queryKey: ['leads-cold-call'] })} className="btn-secondary btn-sm">
            <RefreshCw className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary btn-sm">
            <Plus className="w-3.5 h-3.5" />
            Nouveau lead
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
            <span className="text-sm font-medium text-indigo-700">
              {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="select text-xs py-1 h-7">
                <option value="">— Changer statut —</option>
                {Object.entries(CC_STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <button onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus })}
                disabled={!bulkStatus || bulkStatusMutation.isPending}
                className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors">
                Appliquer
              </button>
            </div>
            {isAdmin && (
              <div className="flex items-center gap-2">
                <select value={bulkSetterId} onChange={(e) => setBulkSetterId(e.target.value)} className="select text-xs py-1 h-7">
                  <option value="">— Assigner à —</option>
                  {(setters as any[] | undefined)?.map((s) => (
                    <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                  ))}
                </select>
                <button onClick={() => bulkAssignMutation.mutate({ ids: Array.from(selected), setterId: bulkSetterId })}
                  disabled={!bulkSetterId || bulkAssignMutation.isPending}
                  className="px-3 py-1 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg flex items-center gap-1">
                  <UserCheck className="w-3.5 h-3.5" /> Assigner
                </button>
              </div>
            )}
            {isAdmin && (
              <button
                onClick={() => {
                  if (confirm(`Supprimer définitivement ${selected.size} lead${selected.size > 1 ? 's' : ''} ? Cette action est irréversible.`)) {
                    bulkDeleteMutation.mutate(Array.from(selected));
                  }
                }}
                disabled={bulkDeleteMutation.isPending}
                className="px-3 py-1 text-xs font-medium bg-red-600 hover:bg-red-700 disabled:opacity-40 text-white rounded-lg flex items-center gap-1">
                <Trash2 className="w-3.5 h-3.5" />
                {bulkDeleteMutation.isPending ? 'Suppression…' : `Supprimer (${selected.size})`}
              </button>
            )}
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48"><Spinner /></div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <p className="text-sm">Aucun lead cold call trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="th w-8">
                    <input ref={selectAllRef} type="checkbox" className="rounded cursor-pointer"
                      checked={allPageSelected} onChange={toggleSelectAll} />
                  </th>
                  <th className="th">Nom</th>
                  <th className="th hidden md:table-cell">Société</th>
                  <th className="th hidden lg:table-cell">Activité</th>
                  <th className="th hidden lg:table-cell">Avis</th>
                  <th className="th hidden lg:table-cell">Téléphone</th>
                  <th className="th">Qualité</th>
                  <th className="th">Statut</th>
                  {isAdmin && <th className="th hidden xl:table-cell">Setter</th>}
                  <th className="th hidden md:table-cell">Créé le</th>
                  <th className="th w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: Lead) => (
                  <tr key={lead.id}
                    className={`table-row cursor-pointer ${selected.has(lead.id) ? 'bg-indigo-50/60' : ''}`}
                    onClick={() => router.push(`/leads/${lead.id}`)}>
                    <td className="td" onClick={(e) => { e.stopPropagation(); toggleSelect(lead.id); }}>
                      <input type="checkbox" checked={selected.has(lead.id)} onChange={() => {}} className="rounded cursor-pointer" />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        {lead.called && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Appelé" />}
                        <div>
                          <p className="font-medium text-gray-900">{lead.first_name} {lead.last_name}</p>
                          {lead.email && <p className="text-xs text-gray-400 truncate max-w-32">{lead.email}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="td hidden md:table-cell text-gray-500">{lead.company ?? '—'}</td>
                    <td className="td hidden lg:table-cell">
                      {lead.niche
                        ? <span className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded-full">{lead.niche}</span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="td hidden lg:table-cell">
                      {lead.rating != null
                        ? <span className="inline-flex items-center gap-1 text-xs text-gray-600 whitespace-nowrap">
                            <Star className="w-3 h-3 fill-amber-400 text-amber-400" />
                            {lead.rating}
                            {lead.reviews != null && <span className="text-gray-400">({lead.reviews})</span>}
                          </span>
                        : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="td hidden lg:table-cell">
                      {lead.phone
                        ? <a href={`tel:${lead.phone}`} onClick={(e) => e.stopPropagation()}
                            className="flex items-center gap-1 text-sm text-gray-600 hover:text-primary-600">
                            <Phone className="w-3 h-3" />{lead.phone}
                          </a>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="td">
                      {lead.lead_quality ? <Badge variant={lead.lead_quality} /> : <span className="text-gray-300 text-xs">—</span>}
                    </td>
                    <td className="td">
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">
                        {CC_STATUS_LABELS[lead.status] ?? lead.status}
                      </span>
                    </td>
                    {isAdmin && (
                      <td className="td hidden xl:table-cell text-gray-500 text-xs">
                        {lead.setter ? `${lead.setter.first_name} ${lead.setter.last_name}` : <span className="text-gray-300">—</span>}
                      </td>
                    )}
                    <td className="td hidden md:table-cell text-gray-500 text-xs">{formatDate(lead.created_at)}</td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button onClick={() => router.push(`/leads/${lead.id}`)}
                          className="p-1.5 hover:bg-primary-50 rounded-lg text-primary-600">
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin && (
                          <button onClick={() => { if (confirm('Supprimer ?')) deleteMutation.mutate(lead.id); }}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-red-400">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">
              {pagination.total} leads · Page {pagination.page}/{pagination.totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
                disabled={pagination.page <= 1} className="btn-secondary btn-sm px-2">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                disabled={pagination.page >= pagination.totalPages} className="btn-secondary btn-sm px-2">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create lead modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau lead Cold Call" size="lg">
        <LeadForm
          defaultSource="cold_call"
          onSuccess={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['leads-cold-call'] });
      qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
            qc.invalidateQueries({ queryKey: ['leads-cc-counts'] });
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </div>
  );
}
