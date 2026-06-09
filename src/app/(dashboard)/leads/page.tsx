'use client';
import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Trash2, Eye, RefreshCw,
  ChevronLeft, ChevronRight, X, UserCheck, AlertTriangle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import LeadForm from '@/components/leads/LeadForm';
import { formatDate, ACTION_LABELS } from '@/lib/utils';
import type { Lead, LeadsFilters, LeadStatus, LeadQuality, LeadSource } from '@/types';

export default function LeadsPage() {
  const router       = useRouter();
  const qc           = useQueryClient();
  const user         = useAuthStore((s) => s.user);
  const isAdmin      = user?.role === 'admin';

  const [filters, setFilters] = useState<LeadsFilters>({ page: 1, limit: 20 });
  const [search,  setSearch]  = useState('');
  const [createOpen,    setCreateOpen]    = useState(false);
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [bulkSetterId,  setBulkSetterId]  = useState('');
  const [bulkSourceVal, setBulkSourceVal] = useState('');
  const selectAllRef = useRef<HTMLInputElement>(null);

  const debouncedSearch = useCallback((val: string) => {
    setSearch(val);
    setFilters((f) => ({ ...f, search: val || undefined, page: 1 }));
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['leads', filters],
    queryFn:  () => leadsApi.getAll(filters).then((r) => r.data),
  });

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
    enabled:  isAdmin,
  });

  const { data: dupData } = useQuery({
    queryKey: ['leads-duplicates'],
    queryFn:  () => leadsApi.duplicates().then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });
  const [dupExpanded, setDupExpanded] = useState(true);

  const deleteMutation = useMutation({
    mutationFn: leadsApi.delete,
    onSuccess:  () => {
      toast.success('Lead supprimé');
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => leadsApi.bulkDelete(ids),
    onSuccess: (_, ids) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} supprimé${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: ({ ids, setterId }: { ids: string[]; setterId: string }) =>
      leadsApi.assign(ids, setterId || null as any),
    onSuccess: (_, { ids }) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} réassigné${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set());
      setBulkSetterId('');
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => toast.error('Erreur lors de la réassignation'),
  });

  const bulkSourceMutation = useMutation({
    mutationFn: ({ ids, source }: { ids: string[]; source: string }) =>
      leadsApi.bulkSource(ids, source),
    onSuccess: (_, { ids, source }) => {
      const label = source === 'instagram' ? 'Instagram' : source === 'facebook' ? 'Facebook' : 'Cold Call';
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} → ${label}`);
      setSelected(new Set());
      setBulkSourceVal('');
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => toast.error('Erreur lors du changement de source'),
  });

  const handleBulkAssign = () => {
    const ids = Array.from(selected);
    bulkAssignMutation.mutate({ ids, setterId: bulkSetterId });
  };

  const leads      = data?.data ?? [];
  const pagination = data?.pagination;

  // Select-all state for current page
  const pageIds         = leads.map((l: Lead) => l.id);
  const allPageSelected = pageIds.length > 0 && pageIds.every((id: string) => selected.has(id));
  const somePageSelected = pageIds.some((id: string) => selected.has(id)) && !allPageSelected;

  // Sync indeterminate state on the checkbox
  if (selectAllRef.current) {
    selectAllRef.current.indeterminate = somePageSelected;
  }

  const toggleSelectAll = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allPageSelected) {
        pageIds.forEach((id: string) => next.delete(id));
      } else {
        pageIds.forEach((id: string) => next.add(id));
      }
      return next;
    });
  };

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const handleDelete = (id: string) => {
    if (confirm('Supprimer ce lead ?')) deleteMutation.mutate(id);
  };

  const handleBulkDelete = () => {
    const ids   = Array.from(selected);
    const count = ids.length;
    if (confirm(`Supprimer ${count} lead${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''} ? Cette action est irréversible.`)) {
      bulkDeleteMutation.mutate(ids);
    }
  };

  return (
    <div className="space-y-4">
      {/* Duplicate warning banner */}
      {dupData && dupData.count > 0 && (
        <div className="rounded-xl border-2 border-amber-400 bg-amber-50 overflow-hidden shadow-sm">
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 bg-amber-100 border-b border-amber-300">
            <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <span className="flex-1 text-sm font-semibold text-amber-900">
              ⚠️ {dupData.count} lead{dupData.count > 1 ? 's' : ''} en doublon détecté{dupData.count > 1 ? 's' : ''} dans votre base
            </span>
            <button
              onClick={() => setDupExpanded((v) => !v)}
              className="text-xs text-amber-700 underline hover:text-amber-900"
            >
              {dupExpanded ? 'Réduire' : 'Voir le détail'}
            </button>
          </div>
          {/* Detail list — visible by default */}
          {dupExpanded && (
            <div className="px-4 py-3">
              <ul className="space-y-1.5">
                {dupData.groups.map((g, i) => (
                  <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                    <span className="shrink-0 font-semibold bg-amber-200 text-amber-900 rounded px-1.5 py-0.5">
                      {g.field === 'phone' ? 'Tél' : 'Email'}
                    </span>
                    <span>
                      <span className="font-medium">{g.value}</span>
                      {' — '}
                      {g.leads.map((l) => `${l.first_name} ${l.last_name}`).join(' · ')}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-48 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={(e) => debouncedSearch(e.target.value)}
            placeholder="Rechercher…"
            className="input pl-9 py-2 text-sm"
          />
          {search && (
            <button onClick={() => debouncedSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2">
              <X className="w-4 h-4 text-gray-400" />
            </button>
          )}
        </div>

        <select
          className="select w-auto text-sm"
          value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as LeadStatus | '', page: 1 }))}
        >
          <option value="">Tous les statuts</option>
          <option value="in_progress">En cours</option>
          <option value="to_follow_up">À relancer</option>
          <option value="to_follow_up_2">À relancer 2</option>
          <option value="appointment">RDV pris</option>
          <option value="r2">R2 pris</option>
          <option value="client">Client</option>
          <option value="lost">Perdu</option>
        </select>

        <select
          className="select w-auto text-sm"
          value={filters.quality ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, quality: e.target.value as LeadQuality | '', page: 1 }))}
        >
          <option value="">Toutes qualités</option>
          <option value="hot">Chaud</option>
          <option value="warm">Tiède</option>
          <option value="cold">Froid</option>
        </select>

        <select
          className="select w-auto text-sm"
          value={filters.source ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, source: e.target.value as LeadSource | '', page: 1 }))}
        >
          <option value="">Toutes sources</option>
          <option value="instagram">📸 Instagram</option>
          <option value="facebook">💬 Facebook</option>
          <option value="cold_call">📞 Cold call</option>
        </select>

        {isAdmin && setters && (
          <select
            className="select w-auto text-sm"
            value={filters.setter_id ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, setter_id: e.target.value || undefined, page: 1 }))}
          >
            <option value="">Tous les setters</option>
            {setters.map((s: any) => (
              <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button onClick={() => qc.invalidateQueries({ queryKey: ['leads'] })} className="btn-secondary btn-sm">
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
        {/* Bulk action bar */}
        {isAdmin && selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
            <span className="text-sm font-medium text-indigo-700">
              {selected.size} lead{selected.size > 1 ? 's' : ''} sélectionné{selected.size > 1 ? 's' : ''}
            </span>

            {/* Bulk assign */}
            <div className="flex items-center gap-2">
              <select
                value={bulkSetterId}
                onChange={(e) => setBulkSetterId(e.target.value)}
                className="select text-xs py-1 h-7"
              >
                <option value="">— Choisir un setter —</option>
                {(setters ?? []).map((s: any) => (
                  <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                ))}
              </select>
              <button
                onClick={handleBulkAssign}
                disabled={!bulkSetterId || bulkAssignMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                <UserCheck className="w-3.5 h-3.5" />
                Assigner
              </button>
            </div>

            {/* Bulk source */}
            <div className="flex items-center gap-2">
              <select
                value={bulkSourceVal}
                onChange={(e) => setBulkSourceVal(e.target.value)}
                className="select text-xs py-1 h-7"
              >
                <option value="">— Changer source —</option>
                <option value="instagram">📸 Instagram</option>
                <option value="facebook">💬 Facebook</option>
                <option value="cold_call">📞 Cold Call</option>
              </select>
              <button
                onClick={() => bulkSourceMutation.mutate({ ids: Array.from(selected), source: bulkSourceVal })}
                disabled={!bulkSourceVal || bulkSourceMutation.isPending}
                className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-violet-600 hover:bg-violet-700 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
                Assigner source
              </button>
            </div>

            <button
              onClick={handleBulkDelete}
              disabled={bulkDeleteMutation.isPending}
              className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white rounded-lg transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Supprimer
            </button>
            <button
              onClick={() => setSelected(new Set())}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              Annuler
            </button>
          </div>
        )}

        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Spinner />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <UsersIcon className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Aucun lead trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {isAdmin && (
                    <th className="th w-8">
                      <input
                        ref={selectAllRef}
                        type="checkbox"
                        className="rounded cursor-pointer"
                        checked={allPageSelected}
                        onChange={toggleSelectAll}
                      />
                    </th>
                  )}
                  <th className="th">Nom</th>
                  <th className="th hidden md:table-cell">Société</th>
                  <th className="th hidden lg:table-cell">Téléphone</th>
                  <th className="th">Qualité</th>
                  <th className="th">Statut</th>
                  {isAdmin && <th className="th hidden xl:table-cell">Setter</th>}
                  <th className="th hidden lg:table-cell">Action</th>
                  <th className="th hidden md:table-cell">Créé le</th>
                  <th className="th w-20">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: Lead) => (
                  <tr
                    key={lead.id}
                    className={`table-row cursor-pointer ${selected.has(lead.id) ? 'bg-indigo-50/60' : ''}`}
                    onClick={() => router.push(`/leads/${lead.id}`)}
                  >
                    {isAdmin && (
                      <td className="td" onClick={(e) => { e.stopPropagation(); toggleSelect(lead.id); }}>
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => {}}
                          className="rounded cursor-pointer"
                        />
                      </td>
                    )}
                    <td className="td">
                      <div className="flex items-center gap-2">
                        {lead.called && (
                          <span className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" title="Appelé" />
                        )}
                        <div>
                          <p className="font-medium text-gray-900">{lead.first_name} {lead.last_name}</p>
                          {lead.email && (
                            <p className="text-xs text-gray-400 truncate max-w-32">{lead.email}</p>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="td hidden md:table-cell text-gray-500">{lead.company ?? '—'}</td>
                    <td className="td hidden lg:table-cell text-gray-500">{lead.phone ?? '—'}</td>
                    <td className="td">
                      {lead.lead_quality
                        ? <Badge variant={lead.lead_quality} />
                        : <span className="text-gray-400 text-xs">—</span>
                      }
                    </td>
                    <td className="td"><Badge variant={lead.status} /></td>
                    {isAdmin && (
                      <td className="td hidden xl:table-cell text-gray-500 text-xs">
                        {lead.setter
                          ? `${lead.setter.first_name} ${lead.setter.last_name}`
                          : <span className="text-gray-300">Non assigné</span>}
                      </td>
                    )}
                    <td className="td hidden lg:table-cell">
                      <span className="text-xs text-gray-500">
                        {ACTION_LABELS[lead.action_in_progress] ?? lead.action_in_progress}
                      </span>
                    </td>
                    <td className="td hidden md:table-cell text-gray-500 text-xs">
                      {formatDate(lead.created_at)}
                    </td>
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => router.push(`/leads/${lead.id}`)}
                          className="p-1.5 hover:bg-primary-50 rounded-lg text-primary-600"
                          title="Voir"
                        >
                          <Eye className="w-3.5 h-3.5" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={() => handleDelete(lead.id)}
                            className="p-1.5 hover:bg-red-50 rounded-lg text-red-500"
                            title="Supprimer"
                          >
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

        {/* Pagination */}
        {pagination && pagination.totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 bg-gray-50">
            <p className="text-sm text-gray-500">
              {pagination.total} résultat{pagination.total > 1 ? 's' : ''} ·
              Page {pagination.page}/{pagination.totalPages}
            </p>
            <div className="flex items-center gap-1">
              <button
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) - 1 }))}
                disabled={pagination.page <= 1}
                className="btn-secondary btn-sm px-2"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setFilters((f) => ({ ...f, page: (f.page ?? 1) + 1 }))}
                disabled={pagination.page >= pagination.totalPages}
                className="btn-secondary btn-sm px-2"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create lead modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau lead" size="lg">
        <LeadForm
          onSuccess={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['leads'] });
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </div>
  );
}

function UsersIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
