'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, UserX, BarChart2, Loader2, ShieldCheck, ShieldOff } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import toast from 'react-hot-toast';
import { usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import { getInitials, formatDate } from '@/lib/utils';
import type { User, UserPerformance } from '@/types';

// Recharts accède à ResizeObserver (browser-only) — chargement côté client
const UserMonthlyChart = dynamic(
  () => import('@/components/dashboard/DashboardCharts').then((m) => m.UserMonthlyChart),
  { ssr: false },
);

// Périodes proposées dans la modale Stats
const PERF_PERIODS: { label: string; days: number }[] = [
  { label: '30 jours', days: 30 },
  { label: '90 jours', days: 90 },
  { label: '12 mois',  days: 365 },
];

// Libellés FR des canaux d'acquisition
const SOURCE_LABELS: Record<string, string> = {
  cold_call: 'Cold Call',
  instagram: 'Instagram',
};

const schema = z.object({
  first_name: z.string().min(1),
  last_name:  z.string().min(1),
  email:      z.string().email(),
  password:   z.string().min(8, '8 caractères minimum'),
  role:       z.enum(['admin', 'setter']).default('setter'),
});
type FormData = z.infer<typeof schema>;

export default function TeamPage() {
  const qc      = useQueryClient();
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [createOpen, setCreateOpen] = useState(false);
  const [perfUser,    setPerfUser]    = useState<User | null>(null);
  const [perfDays,    setPerfDays]    = useState(30);
  const [perfChannel, setPerfChannel] = useState<'cold_call' | 'instagram'>('cold_call');

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn:  () => usersApi.getAll().then((r) => r.data),
  });

  const { data: perf, isFetching: perfLoading } = useQuery({
    queryKey: ['perf', perfUser?.id, perfDays],
    queryFn:  () => usersApi.getPerformance(perfUser!.id, perfDays).then((r) => r.data as UserPerformance),
    enabled:  !!perfUser,
  });

  // Canaux à afficher : ceux assignés au membre, ou ceux où il a des leads.
  const perfSources = perfUser?.acquisition_sources ?? [];
  const hasCold = perfSources.includes('cold_call') || (perf?.cold_call.stats.total_leads ?? 0) > 0;
  const hasIg   = perfSources.includes('instagram') || (perf?.instagram.stats.total_leads ?? 0) > 0;
  const bothChannels = hasCold && hasIg;
  // Canal effectif : on retombe sur le canal disponible si le sélectionné ne l'est pas.
  const channel: 'cold_call' | 'instagram' =
    bothChannels ? perfChannel : (hasIg && !hasCold ? 'instagram' : 'cold_call');

  const deactivate = useMutation({
    mutationFn: (id: string) => usersApi.deactivate(id),
    onSuccess:  () => { toast.success('Utilisateur désactivé'); qc.invalidateQueries({ queryKey: ['users'] }); },
    onError:    () => toast.error('Erreur'),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: 'admin' | 'setter' }) =>
      usersApi.update(id, { role }),
    onSuccess: (_, { role }) => {
      toast.success(`Rôle mis à jour : ${role === 'admin' ? 'Admin' : 'Setter'}`);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Erreur lors du changement de rôle'),
  });

  const updateSources = useMutation({
    mutationFn: ({ id, acquisition_sources }: { id: string; acquisition_sources: string[] }) =>
      usersApi.update(id, { acquisition_sources } as any),
    onSuccess: () => {
      toast.success('Réseaux mis à jour');
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: () => toast.error('Erreur'),
  });

  const createMutation = useMutation({
    mutationFn: (data: FormData) => usersApi.create(data).then((r) => r.data),
    onSuccess:  () => {
      toast.success('Utilisateur créé');
      setCreateOpen(false);
      qc.invalidateQueries({ queryKey: ['users'] });
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Erreur'),
  });

  const { register, handleSubmit, formState: { errors }, reset } = useForm<FormData>({
    resolver: zodResolver(schema),
  });

  if (isLoading) return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8" /></div>;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{users?.length ?? 0} membre(s)</p>
        <button onClick={() => { reset(); setCreateOpen(true); }} className="btn-primary btn-sm">
          <Plus className="w-3.5 h-3.5" />
          Ajouter un membre
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {users?.map((u: any) => (
          <div key={u.id} className={`card p-5 ${!u.is_active ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="w-11 h-11 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                {getInitials(u.first_name, u.last_name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 truncate">
                  {u.first_name} {u.last_name}
                  {u.id === user?.id && <span className="text-xs text-gray-400 ml-1">(moi)</span>}
                </p>
                <p className="text-xs text-gray-500 truncate">{u.email}</p>
                <div className="flex items-center gap-2 mt-1.5">
                  <Badge variant={u.role} />
                  {!u.is_active && <span className="badge bg-red-100 text-red-600">Désactivé</span>}
                </div>
              </div>
            </div>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-2 mt-4 pt-4 border-t border-gray-100">
              {[
                ['Leads', u.total_leads],
                ['Clients', u.clients_signed],
                ['RDV', u.appointments_taken],
              ].map(([label, val]) => (
                <div key={label as string} className="text-center">
                  <p className="text-lg font-bold text-gray-900">{val}</p>
                  <p className="text-xs text-gray-400">{label}</p>
                </div>
              ))}
            </div>

            {/* Source assignment */}
            {isAdmin && (
              <div className="mt-3 pt-3 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-2">Réseaux d'acquisition</p>
                <div className="flex flex-wrap gap-3">
                  {([
                    ['instagram', '📸 Instagram'],
                    ['facebook',  '💬 Facebook'],
                    ['cold_call', '📞 Cold Call'],
                  ] as const).map(([src, label]) => {
                    const srcs      = (u.acquisition_sources ?? []) as string[];
                    const isChecked = srcs.includes(src);
                    return (
                      <label key={src} className="flex items-center gap-1.5 text-xs cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => {
                            const next = isChecked
                              ? srcs.filter((s) => s !== src)
                              : [...srcs, src];
                            updateSources.mutate({ id: u.id, acquisition_sources: next });
                          }}
                          className="rounded text-primary-600 w-3.5 h-3.5"
                        />
                        {label}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => {
                  setPerfDays(30);
                  // Canal par défaut : Instagram si le membre ne fait que ça
                  const srcs = u.acquisition_sources ?? [];
                  setPerfChannel(srcs.includes('cold_call') || !srcs.includes('instagram') ? 'cold_call' : 'instagram');
                  setPerfUser(u);
                }}
                className="btn-secondary btn-sm flex-1 justify-center"
              >
                <BarChart2 className="w-3.5 h-3.5" />
                Stats
              </button>
              {u.id !== user?.id && (
                <button
                  title={u.role === 'admin' ? 'Rétrograder en Setter' : 'Promouvoir en Admin'}
                  onClick={() => {
                    const newRole = u.role === 'admin' ? 'setter' : 'admin';
                    const label   = newRole === 'admin' ? 'admin' : 'setter';
                    if (confirm(`Changer le rôle de ${u.first_name} en ${label} ?`))
                      changeRole.mutate({ id: u.id, role: newRole });
                  }}
                  className="btn-secondary btn-sm"
                >
                  {u.role === 'admin'
                    ? <ShieldOff className="w-3.5 h-3.5 text-orange-500" />
                    : <ShieldCheck className="w-3.5 h-3.5 text-indigo-600" />
                  }
                </button>
              )}
              {u.is_active && u.id !== user?.id && (
                <button
                  onClick={() => { if (confirm(`Désactiver ${u.first_name} ?`)) deactivate.mutate(u.id); }}
                  className="btn-danger btn-sm"
                >
                  <UserX className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>
        ))}
      </div>

      {/* Create user modal */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Ajouter un membre" size="md">
        <form onSubmit={handleSubmit((d) => createMutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Prénom *</label>
              <input {...register('first_name')} className="input" />
              {errors.first_name && <p className="field-error">Requis</p>}
            </div>
            <div>
              <label className="label">Nom *</label>
              <input {...register('last_name')} className="input" />
              {errors.last_name && <p className="field-error">Requis</p>}
            </div>
          </div>
          <div>
            <label className="label">Email *</label>
            <input {...register('email')} type="email" className="input" />
            {errors.email && <p className="field-error">Email invalide</p>}
          </div>
          <div>
            <label className="label">Mot de passe *</label>
            <input {...register('password')} type="password" className="input" />
            {errors.password && <p className="field-error">{errors.password.message}</p>}
          </div>
          <div>
            <label className="label">Rôle</label>
            <select {...register('role')} className="select">
              <option value="setter">Setter</option>
              <option value="admin">Admin</option>
            </select>
          </div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={() => setCreateOpen(false)} className="btn-secondary">Annuler</button>
            <button type="submit" disabled={createMutation.isPending} className="btn-primary">
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
              Créer
            </button>
          </div>
        </form>
      </Modal>

      {/* Performance modal */}
      <Modal
        open={!!perfUser}
        onClose={() => setPerfUser(null)}
        title={perfUser ? `Stats — ${perfUser.first_name} ${perfUser.last_name}` : ''}
        size="xl"
      >
        {/* Sélecteur de canal (si le membre fait les deux) + période */}
        <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
          {bothChannels ? (
            <div className="flex gap-1.5">
              {([['cold_call', 'Cold Call'], ['instagram', 'Instagram']] as const).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => setPerfChannel(key)}
                  className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    channel === key ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-xs font-medium text-gray-500">{SOURCE_LABELS[channel]}</p>
          )}
          <div className="flex gap-1.5">
            {PERF_PERIODS.map(({ label, days }) => (
              <button
                key={days}
                onClick={() => setPerfDays(days)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                  perfDays === days ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {!perf ? (
          <div className="flex items-center justify-center h-40"><Spinner /></div>
        ) : channel === 'cold_call' ? (
          <div className={`space-y-5 ${perfLoading ? 'opacity-60' : ''}`}>
            {/* KPI Cold Call */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([
                ['Total leads',   perf.cold_call.stats.total_leads,          'text-gray-900'],
                ['Appelés',       perf.cold_call.stats.leads_called,         'text-gray-900'],
                ['Relances',      perf.cold_call.stats.follow_ups,           'text-amber-600'],
                ['Relances 2',    perf.cold_call.stats.follow_ups_2,         'text-purple-600'],
                ['RDV pris',      perf.cold_call.stats.appointments_taken,   'text-orange-600'],
                ['RDV honorés',   perf.cold_call.stats.appointments_honored, 'text-orange-600'],
                ['Devis envoyés', perf.cold_call.stats.quotes_sent,          'text-cyan-600'],
                ['Perdus',        perf.cold_call.stats.lost,                 'text-red-600'],
                ['Clients',       perf.cold_call.stats.clients_signed,       'text-green-600'],
              ] as [string, number, string][]).map(([label, val, color]) => (
                <div key={label} className="card p-3 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{val ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Taux */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{perf.cold_call.stats.conversion_rate ?? 0}%</p>
                <p className="text-xs text-gray-500 mt-0.5">Taux de conversion</p>
              </div>
              <div className="card p-3 text-center">
                <p className="text-2xl font-bold text-red-500">{perf.cold_call.stats.no_show_rate ?? 0}%</p>
                <p className="text-xs text-gray-500 mt-0.5">Taux de no-show</p>
              </div>
            </div>

            {/* Qualité des leads */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Qualité des leads</p>
              <div className="grid grid-cols-3 gap-3">
                <div className="card p-3 text-center">
                  <p className="text-xl font-bold text-red-500">{perf.cold_call.stats.hot_leads ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Chauds</p>
                </div>
                <div className="card p-3 text-center">
                  <p className="text-xl font-bold text-orange-500">{perf.cold_call.stats.warm_leads ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Tièdes</p>
                </div>
                <div className="card p-3 text-center">
                  <p className="text-xl font-bold text-blue-500">{perf.cold_call.stats.cold_leads ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Froids</p>
                </div>
              </div>
            </div>

            {/* Évolution mensuelle (6 mois) */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Évolution — 6 derniers mois</p>
              <UserMonthlyChart
                data={[...perf.cold_call.monthly].reverse().map((m) => ({
                  month:   m.month.slice(5),
                  Leads:   Number(m.total),
                  RDV:     Number(m.appointments),
                  Clients: Number(m.clients),
                }))}
              />
            </div>
          </div>
        ) : (
          <div className={`space-y-5 ${perfLoading ? 'opacity-60' : ''}`}>
            {/* KPI Instagram */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([
                ['Total leads',   perf.instagram.stats.total_leads,  'text-gray-900'],
                ['M1 envoyés',    perf.instagram.stats.m1_sent,      'text-blue-600'],
                ['R1',            perf.instagram.stats.r1,           'text-amber-600'],
                ['R2',            perf.instagram.stats.r2,           'text-purple-600'],
                ['Réponses',      perf.instagram.stats.reponse,      'text-cyan-600'],
                ['Audit envoyé',  perf.instagram.stats.audit_envoye, 'text-indigo-600'],
                ['RDV',           perf.instagram.stats.rdv,          'text-orange-600'],
                ['Ouverts',       perf.instagram.stats.open_count,   'text-gray-900'],
              ] as [string, number, string][]).map(([label, val, color]) => (
                <div key={label} className="card p-3 text-center">
                  <p className={`text-2xl font-bold ${color}`}>{val ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{label}</p>
                </div>
              ))}
            </div>

            {/* Taux */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">{perf.instagram.stats.open_rate ?? 0}%</p>
                <p className="text-xs text-gray-500 mt-0.5">Taux d'ouverture</p>
              </div>
              <div className="card p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{perf.instagram.stats.rdv_conversion_rate ?? 0}%</p>
                <p className="text-xs text-gray-500 mt-0.5">Taux de conversion RDV</p>
              </div>
            </div>

            {/* Évolution mensuelle (6 mois) */}
            <div>
              <p className="text-xs font-semibold text-gray-700 mb-2">Évolution — 6 derniers mois</p>
              <UserMonthlyChart
                data={[...perf.instagram.monthly].reverse().map((m) => ({
                  month: m.month.slice(5),
                  Leads: Number(m.total),
                  RDV:   Number(m.rdv),
                }))}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
