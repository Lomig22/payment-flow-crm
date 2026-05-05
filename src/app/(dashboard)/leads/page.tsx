'use client';
import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Plus, Search, Filter, Trash2, Eye, RefreshCw,
  ChevronLeft, ChevronRight, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import LeadForm from '@/components/leads/LeadForm';
import { formatDate, ACTION_LABELS } from '@/lib/utils';
import type { Lead, LeadsFilters, LeadStatus, LeadQuality } from '@/types';

export default function LeadsPage() {
  const router       = useRouter();
  const qc           = useQueryClient();
  const user         = useAuthStore((s) => s.user);
  const isAdmin      = user?.role === 'admin';

  const [filters, setFilters] = useState<LeadsFilters>({ page: 1, limit: 20 });
  const [search,  setSearch]  = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [selected,   setSelected]  = useState<Set<string>>(new Set());

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

  const deleteMutation = useMutation({
    mutationFn: leadsApi.delete,
    onSuccess:  () => {
      toast.success('Lead supprimé');
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: () => toast.error('Erreur lors de la suppression'),
  });

  const leads      = data?.data ?? [];
  const pagination = data?.pagination;

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

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
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

        {/* Filters */}
        <select
          className="select w-auto text-sm"
          value={filters.status ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value as LeadStatus | '', page: 1 }))}
        >
          <option value="">Tous les statuts</option>
          <option value="in_progress">En cours</option>
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
        {isLoading ? (
          <div className="flex items-center justify-center h-48">
            <Spinner />
          </div>
        ) : leads.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 text-gray-400">
            <Users className="w-10 h-10 mb-2 opacity-30" />
            <p className="text-sm">Aucun lead trouvé</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  {isAdmin && <th className="th w-8"><input type="checkbox" className="rounded" /></th>}
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
                  <tr key={lead.id} className="table-row cursor-pointer" onClick={() => router.push(`/leads/${lead.id}`)}>
                    {isAdmin && (
                      <td className="td" onClick={(e) => { e.stopPropagation(); toggleSelect(lead.id); }}>
                        <input
                          type="checkbox"
                          checked={selected.has(lead.id)}
                          onChange={() => {}}
                          className="rounded"
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

function Users({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
        d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}
