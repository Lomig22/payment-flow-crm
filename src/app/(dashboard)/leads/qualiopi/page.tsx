'use client';
import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Search, Eye, RefreshCw, X, ChevronLeft, ChevronRight, Trash2, UserCheck, Phone, Plus,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { qualiopiLeadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import QualiopiLeadForm from '@/components/leads/QualiopiLeadForm';
import { formatDate } from '@/lib/utils';
import type { QualiopiLead, QualiopiLeadsFilters, QualiopiStatus, LeadQuality } from '@/types';

const Q_STATUS_LABELS: Record<string, string> = {
  in_progress: 'En cours', to_follow_up: 'À relancer', to_follow_up_2: 'À relancer 2',
  appointment: 'RDV pris', r2: 'R2 pris', client: 'Client', lost: 'Perdu',
};

const Q_TABS = [
  { label: 'Tous',          value: '' },
  { label: 'En cours',      value: 'in_progress' },
  { label: 'À relancer',    value: 'to_follow_up' },
  { label: 'À relancer 2',  value: 'to_follow_up_2' },
  { label: 'RDV pris',      value: 'appointment' },
  { label: 'R2 pris',       value: 'r2' },
  { label: 'Client',        value: 'client' },
  { label: 'Perdu',         value: 'lost' },
];

export default function QualiopiLeadsPage() {
  const router  = useRouter();
  const qc      = useQueryClient();
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [activeTab,    setActiveTab]    = useState('');
  const [filters,      setFilters]      = useState<QualiopiLeadsFilters>({ page: 1, limit: 50 });
  const [search,       setSearch]       = useState('');
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
    setFilters((f) => ({ ...f, status: (tab || undefined) as QualiopiStatus | undefined, page: 1 }));
    setSelected(new Set());
  };

  // Counts per status (tab badges)
  const { data: countsData } = useQuery({
    queryKey: ['qualiopi-counts', filters.setter_id],
    queryFn: () => qualiopiLeadsApi.getAll({
      count_only: true,
      ...(filters.setter_id ? { setter_id: filters.setter_id } : {}),
    } as QualiopiLeadsFilters).then((r) => r.data.counts as Record<string, number> | undefined),
    staleTime: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['qualiopi-leads', filters],
    queryFn:  () => qualiopiLeadsApi.getAll(filters).then((r) => r.data),
  });

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
    enabled:  isAdmin,
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      qualiopiLeadsApi.bulkStatus(ids, status),
    onSuccess: (_, { ids }) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} mis à jour`);
      setSelected(new Set()); setBulkStatus('');
      qc.invalidateQueries({ queryKey: ['qualiopi-leads'] });
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: ({ ids, setterId }: { ids: string[]; setterId: string }) =>
      qualiopiLeadsApi.assign(ids, setterId),
    onSuccess: (_, { ids }) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} réassigné${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set()); setBulkSetterId('');
      qc.invalidateQueries({ queryKey: ['qualiopi-leads'] });
    },
    onError: () => toast.error('Erreur lors de la réassignation'),
  });

  const deleteMutation = useMutation({
    mutationFn: qualiopiLeadsApi.delete,
    onSuccess: () => {
      toast.success('Lead supprimé');
      qc.invalidateQueries({ queryKey: ['qualiopi-leads'] });
      qc.invalidateQueries({ queryKey: ['qualiopi-counts'] });
    },
  });

  const leads      = data?.data ?? [];
  const pagination = data?.pagination;
  const pageIds    = leads.map((l: QualiopiLead) => l.id);
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
      {/* Tabs */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex border-b border-gray-100 min-w-max">
            {Q_TABS.map((tab) => {
              const count = tab.value ? (countsData?.[tab.value] ?? 0) : (totalCount ?? 0);
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => handleTabChange(tab.value)}
                  className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5
                    ${isActive
                      ? 'border-teal-500 text-teal-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold
                      ${isActive ? 'bg-teal-100 text-teal-600' : 'bg-gray-100 text-gray-500'}`}>
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
            placeholder="Rechercher entreprise, dirigeant, téléphone…" className="input pl-9 py-2 text-sm" />
          {search && (
            <button onClick={() => debouncedSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        <select className="select w-auto text-sm" value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as QualiopiStatus | '', page: 1 }))}>
          <option value="">Tous les statuts</option>
          {Object.entries(Q_STATUS_LABELS).map(([val, label]) => (
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
          <button onClick={() => qc.invalidateQueries({ queryKey: ['qualiopi-leads'] })} className="btn-secondary btn-sm">
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
                {Object.entries(Q_STATUS_LABELS).map(([val, label]) => (
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
            <button onClick={() => setSelected(new Set())} className="text-sm text-gray-500 hover:text-gray-700">Annuler</button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48"><Spinner /></div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <p className="text-sm">Aucun lead Qualiopi trouvé</p>
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
                  <th className="th">Entreprise</th>
                  <th className="th hidden md:table-cell">Dirigeant</th>
                  <th className="th hidden lg:table-cell">Activité</th>
                  <th className="th hidden lg:table-cell">Téléphone</th>
                  <th className="th">Qualité</th>
                  <th className="th">Statut</th>
                  {isAdmin && <th className="th hidden xl:table-cell">Setter</th>}
                  <th className="th hidden md:table-cell">Créé le</th>
                  <th className="th w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: QualiopiLead) => (
                  <tr key={lead.id}
                    className={`table-row cursor-pointer ${selected.has(lead.id) ? 'bg-indigo-50/60' : ''}`}
                    onClick={() => router.push(`/qualiopi/${lead.id}`)}>
                    <td className="td" onClick={(e) => { e.stopPropagation(); toggleSelect(lead.id); }}>
                      <input type="checkbox" checked={selected.has(lead.id)} onChange={() => {}} className="rounded cursor-pointer" />
                    </td>
                    <td className="td">
                      <div className="flex items-center gap-2">
                        {lead.called && <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Appelé" />}
                        <div>
                          <p className="font-medium text-gray-900">{lead.company}</p>
                          {lead.city && <p className="text-xs text-gray-400 truncate max-w-32">{lead.city}</p>}
                        </div>
                      </div>
                    </td>
                    <td className="td hidden md:table-cell text-gray-500">{lead.dirigeant ?? '—'}</td>
                    <td className="td hidden lg:table-cell text-gray-500 text-xs">{lead.activite ?? '—'}</td>
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
                        {Q_STATUS_LABELS[lead.status] ?? lead.status}
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
                        <button onClick={() => router.push(`/qualiopi/${lead.id}`)}
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
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau lead Qualiopi" size="lg">
        <QualiopiLeadForm
          onSuccess={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['qualiopi-leads'] });
            qc.invalidateQueries({ queryKey: ['qualiopi-counts'] });
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </div>
  );
}
