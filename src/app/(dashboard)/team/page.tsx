'use client';
import { useState } from 'react';
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
import type { User } from '@/types';

const schema = z.object({
  first_name: z.string().min(1),
  last_name:  z.string().min(1),
  email:      z.string().email(),
  password:   z.string().min(8, '8 caractères minimum'),
  role:       z.enum(['admin', 'setter']).default('setter'),
});
type FormData = z.infer<typeof schema>;

export default function TeamPage() {
  const qc   = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [createOpen, setCreateOpen] = useState(false);
  const [perfUser,   setPerfUser]   = useState<User | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn:  () => usersApi.getAll().then((r) => r.data),
  });

  const { data: perf } = useQuery({
    queryKey: ['perf', perfUser?.id],
    queryFn:  () => usersApi.getPerformance(perfUser!.id).then((r) => r.data),
    enabled:  !!perfUser,
  });

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

            {/* Actions */}
            <div className="flex gap-2 mt-4">
              <button
                onClick={() => setPerfUser(u)}
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
        size="md"
      >
        {perf ? (
          <div className="grid grid-cols-2 gap-3">
            {[
              ['Total leads',    perf.total_leads],
              ['Appelés',        perf.called_leads],
              ['RDV pris',       perf.appointments_taken],
              ['RDV honorés',    perf.appointments_honored],
              ['Devis envoyés',  perf.quotes_sent],
              ['Clients',        perf.clients_signed],
              ['Leads perdus',   perf.lost],
              ['Leads chauds',   perf.hot_leads],
            ].map(([label, val]) => (
              <div key={label as string} className="card p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{val ?? 0}</p>
                <p className="text-xs text-gray-500 mt-0.5">{label}</p>
              </div>
            ))}
            <div className="card p-3 text-center col-span-2">
              <p className="text-2xl font-bold text-green-600">{perf.conversion_rate ?? 0}%</p>
              <p className="text-xs text-gray-500 mt-0.5">Taux de conversion</p>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center h-32"><Spinner /></div>
        )}
      </Modal>
    </div>
  );
}
