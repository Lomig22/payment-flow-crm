'use client';
import { useState, useCallback, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  Search, Eye, RefreshCw, ExternalLink, X, Plus,
  ChevronLeft, ChevronRight, Trash2, UserCheck, MessageCircle,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Spinner from '@/components/ui/Spinner';
import Modal from '@/components/ui/Modal';
import LeadForm from '@/components/leads/LeadForm';
import { formatDate } from '@/lib/utils';
import type { Lead, LeadsFilters, LeadStatus } from '@/types';

const NICHE_OPTIONS = [
  'Électricien','Plombier','Couvreur','Maçon','Menuisier',
  'Peintre','Carreleur','Plaquiste','Climatisation','Multi-corps','Autre',
];

const IG_STATUS_LABELS: Record<string, string> = {
  lead: 'Lead', m1: 'M1 envoyé', r1: 'R1', r2: 'R2',
  reponse: 'Réponse', a_relancer: 'À relancer',
  audit_a_envoyer: 'Audit à envoyer', audit_envoye: 'Audit envoyé', rdv: 'RDV',
};

const RDV_OUTCOME_LABELS: Record<string, string> = {
  present: 'Présent', vendu: 'Vendu', no_show: 'No Show', pas_qualifie: 'Non qualifié',
};
const RDV_OUTCOME_COLORS: Record<string, string> = {
  vendu:         'bg-green-100 text-green-700',
  no_show:       'bg-red-100 text-red-600',
  pas_qualifie:  'bg-orange-100 text-orange-600',
  present:       'bg-blue-100 text-blue-700',
};

const IG_TABS = [
  { label: 'Tous',           value: '' },
  { label: 'Lead',           value: 'lead' },
  { label: 'M1 envoyé',      value: 'm1' },
  { label: 'R1',             value: 'r1' },
  { label: 'R2',             value: 'r2' },
  { label: 'Réponse',        value: 'reponse' },
  { label: 'À relancer',     value: 'a_relancer' },
  { label: 'Audit à env.',   value: 'audit_a_envoyer' },
  { label: 'Audit envoyé',   value: 'audit_envoye' },
  { label: 'RDV',            value: 'rdv' },
];

function OpenRateBar({ leads }: { leads: Lead[] }) {
  const total  = leads.length;
  const opened = leads.filter((l) => l.a_ouvert).length;
  const rate   = total > 0 ? Math.round((opened / total) * 100) : 0;
  const color  = rate >= 50 ? 'bg-green-500' : rate >= 25 ? 'bg-yellow-400' : 'bg-red-400';

  return (
    <div className="card p-4 flex items-center gap-6">
      <div className="text-center">
        <p className="text-2xl font-bold text-gray-900">{rate}%</p>
        <p className="text-xs text-gray-500">Taux d'ouverture</p>
      </div>
      <div className="flex-1">
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>{opened} ouverts</span>
          <span>{total} total</span>
        </div>
        <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
          <div className={`h-full ${color} rounded-full transition-all`} style={{ width: `${rate}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 text-center">
        <div><p className="text-lg font-semibold text-gray-800">{total}</p><p className="text-xs text-gray-400">Leads</p></div>
        <div><p className="text-lg font-semibold text-green-600">{opened}</p><p className="text-xs text-gray-400">Ouverts</p></div>
        <div><p className="text-lg font-semibold text-gray-400">{total - opened}</p><p className="text-xs text-gray-400">Non ouverts</p></div>
      </div>
    </div>
  );
}

export default function InstagramLeadsPage() {
  const router  = useRouter();
  const qc      = useQueryClient();
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const [activeTab,    setActiveTab]    = useState('');
  const [filters,      setFilters]      = useState<LeadsFilters>({ page: 1, limit: 50, source: 'instagram' });
  const [search,       setSearch]       = useState('');
  const [selected,     setSelected]     = useState<Set<string>>(new Set());
  const [bulkStatus,   setBulkStatus]   = useState('');
  const [bulkSetterId, setBulkSetterId] = useState('');
  const [qrInput,      setQrInput]      = useState('');
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

  // Counts per status (for tab badges)
  const { data: countsData } = useQuery({
    queryKey: ['leads-instagram-counts', filters.setter_id, filters.niche],
    queryFn: () => leadsApi.getAll({
      source: 'instagram', count_only: true,
      ...(filters.setter_id ? { setter_id: filters.setter_id } : {}),
      ...(filters.niche     ? { niche: filters.niche }         : {}),
    } as LeadsFilters).then((r) => r.data.counts as Record<string, number> | undefined),
    staleTime: 30_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['leads-instagram', filters],
    queryFn:  () => leadsApi.getAll(filters).then((r) => r.data),
  });

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
    enabled:  isAdmin,
  });

  // Quick Reply: @username → status 'reponse'
  const qrMutation = useMutation({
    mutationFn: async (username: string) => {
      const r = await leadsApi.getAll({ source: 'instagram', instagram_username: username, limit: 1 } as LeadsFilters);
      const lead = r.data?.data?.[0];
      if (!lead) throw new Error(`@${username} introuvable dans les leads Instagram`);
      await leadsApi.update(lead.id, { status: 'reponse' as any });
      return lead;
    },
    onSuccess: (lead) => {
      const handle = lead.instagram_username ? `@${lead.instagram_username}` : `${lead.first_name} ${lead.last_name}`;
      toast.success(`${handle} → Réponse ✓`);
      setQrInput('');
      qc.invalidateQueries({ queryKey: ['leads-instagram'] });
      qc.invalidateQueries({ queryKey: ['leads-instagram-counts'] });
    },
    onError: (err: any) => toast.error(err.message ?? 'Erreur Quick Reply'),
  });

  const handleQuickReply = (e: React.FormEvent) => {
    e.preventDefault();
    const username = qrInput.trim().replace(/^@/, '');
    if (!username) return;
    qrMutation.mutate(username);
  };

  const toggleOuvertMutation = useMutation({
    mutationFn: ({ id, val }: { id: string; val: boolean }) =>
      leadsApi.update(id, { a_ouvert: val } as any),
    onMutate: async ({ id, val }) => {
      await qc.cancelQueries({ queryKey: ['leads-instagram', filters] });
      qc.setQueryData(['leads-instagram', filters], (old: any) => ({
        ...old,
        data: old?.data?.map((l: Lead) => l.id === id ? { ...l, a_ouvert: val } : l) ?? [],
      }));
    },
    onError: () => { qc.invalidateQueries({ queryKey: ['leads-instagram'] }); toast.error('Erreur'); },
  });

  const nicheMutation = useMutation({
    mutationFn: ({ id, niche }: { id: string; niche: string }) =>
      leadsApi.update(id, { niche } as any),
    onMutate: async ({ id, niche }) => {
      await qc.cancelQueries({ queryKey: ['leads-instagram', filters] });
      qc.setQueryData(['leads-instagram', filters], (old: any) => ({
        ...old,
        data: old?.data?.map((l: Lead) => l.id === id ? { ...l, niche } : l) ?? [],
      }));
    },
    onError: () => { qc.invalidateQueries({ queryKey: ['leads-instagram'] }); toast.error('Erreur niche'); },
  });

  const rdvOutcomeMutation = useMutation({
    mutationFn: ({ id, rdv_outcome }: { id: string; rdv_outcome: string }) =>
      leadsApi.update(id, { rdv_outcome } as any),
    onMutate: async ({ id, rdv_outcome }) => {
      await qc.cancelQueries({ queryKey: ['leads-instagram', filters] });
      qc.setQueryData(['leads-instagram', filters], (old: any) => ({
        ...old,
        data: old?.data?.map((l: Lead) => l.id === id ? { ...l, rdv_outcome } : l) ?? [],
      }));
    },
    onError: () => { qc.invalidateQueries({ queryKey: ['leads-instagram'] }); toast.error('Erreur résultat RDV'); },
  });

  const bulkStatusMutation = useMutation({
    mutationFn: ({ ids, status }: { ids: string[]; status: string }) =>
      leadsApi.bulkStatus(ids, status),
    onSuccess: (_, { ids, status }) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} → ${IG_STATUS_LABELS[status] ?? status}`);
      setSelected(new Set()); setBulkStatus('');
      qc.invalidateQueries({ queryKey: ['leads-instagram'] });
      qc.invalidateQueries({ queryKey: ['leads-instagram-counts'] });
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  });

  const bulkAssignMutation = useMutation({
    mutationFn: ({ ids, setterId }: { ids: string[]; setterId: string }) =>
      leadsApi.assign(ids, setterId),
    onSuccess: (_, { ids }) => {
      toast.success(`${ids.length} lead${ids.length > 1 ? 's' : ''} réassigné${ids.length > 1 ? 's' : ''}`);
      setSelected(new Set()); setBulkSetterId('');
      qc.invalidateQueries({ queryKey: ['leads-instagram'] });
    },
    onError: () => toast.error('Erreur lors de la réassignation'),
  });

  const deleteMutation = useMutation({
    mutationFn: leadsApi.delete,
    onSuccess: () => {
      toast.success('Lead supprimé');
      qc.invalidateQueries({ queryKey: ['leads-instagram'] });
      qc.invalidateQueries({ queryKey: ['leads-instagram-counts'] });
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

  const totalCount = countsData
    ? Object.values(countsData).reduce((a, b) => a + b, 0)
    : undefined;

  return (
    <div className="space-y-4">
      {/* Open rate — only on "Tous" tab */}
      {!isLoading && leads.length > 0 && activeTab === '' && <OpenRateBar leads={leads} />}

      {/* Quick Reply Bar */}
      <div className="card p-3 border-pink-100 bg-gradient-to-r from-pink-50/60 to-purple-50/60">
        <form onSubmit={handleQuickReply} className="flex items-center gap-3">
          <MessageCircle className="w-4 h-4 text-pink-500 flex-shrink-0" />
          <span className="text-sm font-medium text-pink-700 whitespace-nowrap hidden sm:block">Quick Reply</span>
          <div className="relative flex-1">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 text-sm font-medium">@</span>
            <input
              value={qrInput}
              onChange={(e) => setQrInput(e.target.value)}
              placeholder="username · Entre pour marquer comme Réponse"
              className="input pl-7 py-1.5 text-sm"
            />
          </div>
          <button
            type="submit"
            disabled={!qrInput.trim() || qrMutation.isPending}
            className="btn-primary btn-sm whitespace-nowrap"
          >
            {qrMutation.isPending ? <Spinner className="w-3.5 h-3.5" /> : '→ Réponse'}
          </button>
        </form>
      </div>

      {/* Tabs */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <div className="flex border-b border-gray-100 min-w-max">
            {IG_TABS.map((tab) => {
              const count = tab.value
                ? (countsData?.[tab.value] ?? 0)
                : (totalCount ?? 0);
              const isActive = activeTab === tab.value;
              return (
                <button
                  key={tab.value}
                  onClick={() => handleTabChange(tab.value)}
                  className={`px-3 py-2.5 text-xs font-medium whitespace-nowrap border-b-2 transition-colors flex items-center gap-1.5
                    ${isActive
                      ? 'border-pink-500 text-pink-600'
                      : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                    }`}
                >
                  {tab.label}
                  {count > 0 && (
                    <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-semibold
                      ${isActive ? 'bg-pink-100 text-pink-600' : 'bg-gray-100 text-gray-500'}`}>
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
          <input
            value={search}
            onChange={(e) => debouncedSearch(e.target.value)}
            placeholder="Rechercher @username, nom…"
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
          value={filters.niche ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, niche: e.target.value || undefined, page: 1 }))}
        >
          <option value="">Toutes niches</option>
          {NICHE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>

        <select
          className="select w-auto text-sm"
          value={filters.a_ouvert ?? ''}
          onChange={(e) => setFilters((f) => ({ ...f, a_ouvert: e.target.value || undefined, page: 1 }))}
        >
          <option value="">Tous</option>
          <option value="true">Ouvert ✓</option>
          <option value="false">Non ouvert</option>
        </select>

        {isAdmin && setters && (
          <select
            className="select w-auto text-sm"
            value={filters.setter_id ?? ''}
            onChange={(e) => setFilters((f) => ({ ...f, setter_id: e.target.value || undefined, page: 1 }))}
          >
            <option value="">Tous les setters</option>
            {(setters as any[]).map((s) => (
              <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
            ))}
          </select>
        )}

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => {
              qc.invalidateQueries({ queryKey: ['leads-instagram'] });
              qc.invalidateQueries({ queryKey: ['leads-instagram-counts'] });
            }}
            className="btn-secondary btn-sm"
          >
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
        {/* Bulk bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 bg-indigo-50 border-b border-indigo-100">
            <span className="text-sm font-medium text-indigo-700">
              {selected.size} sélectionné{selected.size > 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-2">
              <select value={bulkStatus} onChange={(e) => setBulkStatus(e.target.value)} className="select text-xs py-1 h-7">
                <option value="">— Changer statut —</option>
                {Object.entries(IG_STATUS_LABELS).map(([val, label]) => (
                  <option key={val} value={val}>{label}</option>
                ))}
              </select>
              <button
                onClick={() => bulkStatusMutation.mutate({ ids: Array.from(selected), status: bulkStatus })}
                disabled={!bulkStatus || bulkStatusMutation.isPending}
                className="px-3 py-1 text-xs font-medium bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 text-white rounded-lg transition-colors"
              >
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
                <button
                  onClick={() => bulkAssignMutation.mutate({ ids: Array.from(selected), setterId: bulkSetterId })}
                  disabled={!bulkSetterId || bulkAssignMutation.isPending}
                  className="px-3 py-1 text-xs font-medium bg-green-600 hover:bg-green-700 disabled:opacity-40 text-white rounded-lg transition-colors flex items-center gap-1"
                >
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
            <p className="text-sm">Aucun lead Instagram {activeTab ? `en statut "${IG_STATUS_LABELS[activeTab]}"` : ''}</p>
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
                  <th className="th">Compte</th>
                  <th className="th hidden md:table-cell">Niche</th>
                  <th className="th">Ouvert ?</th>
                  <th className="th hidden sm:table-cell">Score</th>
                  <th className="th">Statut</th>
                  {activeTab === 'rdv' && <th className="th">Résultat RDV</th>}
                  {isAdmin && <th className="th hidden xl:table-cell">Setter</th>}
                  <th className="th hidden md:table-cell">Créé le</th>
                  <th className="th w-16">Actions</th>
                </tr>
              </thead>
              <tbody>
                {leads.map((lead: Lead) => (
                  <tr key={lead.id} className={`table-row ${selected.has(lead.id) ? 'bg-indigo-50/60' : ''}`}>
                    <td className="td" onClick={() => toggleSelect(lead.id)}>
                      <input type="checkbox" checked={selected.has(lead.id)} onChange={() => {}} className="rounded cursor-pointer" />
                    </td>

                    {/* Compte */}
                    <td className="td cursor-pointer" onClick={() => router.push(`/leads/${lead.id}`)}>
                      <div className="flex items-center gap-2">
                        <div>
                          <div className="flex items-center gap-1.5">
                            <p className="font-medium text-gray-900 text-sm">
                              {lead.instagram_username ? `@${lead.instagram_username}` : `${lead.first_name} ${lead.last_name}`}
                            </p>
                            {lead.instagram_url && (
                              <a href={lead.instagram_url} target="_blank" rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="text-pink-500 hover:text-pink-600 flex-shrink-0"
                                title="Ouvrir le profil Instagram">
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                          {lead.company && lead.instagram_username && (
                            <p className="text-xs text-gray-400">{lead.company}</p>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Niche */}
                    <td className="td hidden md:table-cell" onClick={(e) => e.stopPropagation()}>
                      <select
                        value={lead.niche ?? ''}
                        onChange={(e) => nicheMutation.mutate({ id: lead.id, niche: e.target.value })}
                        className="text-xs border border-gray-200 rounded-md px-2 py-1 bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-primary-400 cursor-pointer"
                      >
                        <option value="">— niche —</option>
                        {NICHE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                    </td>

                    {/* A ouvert toggle */}
                    <td className="td" onClick={(e) => e.stopPropagation()}>
                      <button
                        onClick={() => toggleOuvertMutation.mutate({ id: lead.id, val: !lead.a_ouvert })}
                        className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus:outline-none
                          ${lead.a_ouvert ? 'bg-green-500' : 'bg-gray-200'}`}
                        title={lead.a_ouvert ? 'A ouvert le DM' : "N'a pas ouvert"}
                      >
                        <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform
                          ${lead.a_ouvert ? 'translate-x-4' : 'translate-x-0.5'}`} />
                      </button>
                    </td>

                    {/* Score */}
                    <td className="td hidden sm:table-cell">
                      {lead.ig_score != null ? (
                        <span className={`text-xs font-medium px-1.5 py-0.5 rounded
                          ${lead.ig_score >= 15 ? 'bg-green-100 text-green-700' : lead.ig_score >= 8 ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}>
                          {lead.ig_score}
                        </span>
                      ) : <span className="text-gray-300 text-xs">—</span>}
                    </td>

                    {/* Statut */}
                    <td className="td" onClick={() => router.push(`/leads/${lead.id}`)}>
                      <span className="text-xs bg-gray-100 text-gray-700 px-2 py-0.5 rounded-full font-medium">
                        {IG_STATUS_LABELS[lead.status] ?? lead.status}
                      </span>
                    </td>

                    {/* Résultat RDV (tab rdv only) */}
                    {activeTab === 'rdv' && (
                      <td className="td" onClick={(e) => e.stopPropagation()}>
                        <select
                          value={lead.rdv_outcome ?? ''}
                          onChange={(e) => rdvOutcomeMutation.mutate({ id: lead.id, rdv_outcome: e.target.value })}
                          className={`text-xs border rounded-md px-2 py-1 focus:outline-none focus:ring-1 focus:ring-primary-400 cursor-pointer
                            ${lead.rdv_outcome ? `border-transparent ${RDV_OUTCOME_COLORS[lead.rdv_outcome]}` : 'border-gray-200 bg-white text-gray-500'}`}
                        >
                          <option value="">— résultat —</option>
                          {Object.entries(RDV_OUTCOME_LABELS).map(([val, label]) => (
                            <option key={val} value={val}>{label}</option>
                          ))}
                        </select>
                      </td>
                    )}

                    {/* Setter */}
                    {isAdmin && (
                      <td className="td hidden xl:table-cell text-gray-500 text-xs" onClick={() => router.push(`/leads/${lead.id}`)}>
                        {lead.setter ? `${lead.setter.first_name} ${lead.setter.last_name}` : <span className="text-gray-300">—</span>}
                      </td>
                    )}

                    {/* Date */}
                    <td className="td hidden md:table-cell text-gray-500 text-xs" onClick={() => router.push(`/leads/${lead.id}`)}>
                      {formatDate(lead.created_at)}
                    </td>

                    {/* Actions */}
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

        {/* Pagination */}
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
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Nouveau lead Instagram" size="lg">
        <LeadForm
          defaultSource="instagram"
          onSuccess={() => {
            setCreateOpen(false);
            qc.invalidateQueries({ queryKey: ['leads-instagram'] });
            qc.invalidateQueries({ queryKey: ['leads-instagram-counts'] });
          }}
          onCancel={() => setCreateOpen(false)}
        />
      </Modal>
    </div>
  );
}
