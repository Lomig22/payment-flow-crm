'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { Loader2, Shield, User } from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import { getInitials } from '@/lib/utils';

const nameSchema = z.object({
  first_name: z.string().min(1, 'Requis'),
  last_name:  z.string().min(1, 'Requis'),
});
type NameForm = z.infer<typeof nameSchema>;

const pwdSchema = z.object({
  old_password: z.string().min(1, 'Requis'),
  new_password: z.string().min(8, '8 caractères minimum'),
  confirm:      z.string(),
}).refine((d) => d.new_password === d.confirm, {
  message: 'Les mots de passe ne correspondent pas',
  path: ['confirm'],
});
type PwdForm = z.infer<typeof pwdSchema>;

export default function ProfilePage() {
  const { user, updateUser } = useAuthStore();

  const {
    register: rName,
    handleSubmit: hsName,
    formState: { errors: nameErrors },
  } = useForm<NameForm>({
    resolver: zodResolver(nameSchema),
    defaultValues: { first_name: user?.first_name ?? '', last_name: user?.last_name ?? '' },
  });

  const nameMutation = useMutation({
    mutationFn: (d: NameForm) => usersApi.update(user!.id, d).then((r) => r.data),
    onSuccess: (data: any) => {
      toast.success('Nom mis à jour');
      updateUser({ first_name: data.first_name, last_name: data.last_name });
    },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Erreur'),
  });

  const { register, handleSubmit, formState: { errors }, reset } = useForm<PwdForm>({
    resolver: zodResolver(pwdSchema),
  });

  const mutation = useMutation({
    mutationFn: (d: PwdForm) => authApi.changePassword(d.old_password, d.new_password),
    onSuccess:  () => { toast.success('Mot de passe mis à jour'); reset(); },
    onError: (err: any) => toast.error(err.response?.data?.message ?? 'Erreur'),
  });

  return (
    <div className="max-w-lg mx-auto space-y-5">
      {/* Profile card */}
      <div className="card p-6">
        <div className="flex items-center gap-4 mb-5">
          <div className="w-16 h-16 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-2xl font-bold">
            {getInitials(user?.first_name ?? '', user?.last_name ?? '')}
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">{user?.first_name} {user?.last_name}</h2>
            <p className="text-gray-500 text-sm">{user?.email}</p>
            <div className="mt-1"><Badge variant={user?.role ?? 'setter'} /></div>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400">Rôle</p>
            <p className="font-medium capitalize">{user?.role === 'admin' ? 'Administrateur' : 'Setter'}</p>
          </div>
          <div className="bg-gray-50 rounded-lg p-3">
            <p className="text-xs text-gray-400">Statut</p>
            <p className={`font-medium ${user?.is_active ? 'text-green-600' : 'text-red-500'}`}>
              {user?.is_active ? 'Actif' : 'Désactivé'}
            </p>
          </div>
        </div>
      </div>

      {/* Edit name */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <User className="w-4 h-4 text-gray-400" />
          Modifier le nom
        </h3>
        <form onSubmit={hsName((d) => nameMutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Prénom</label>
              <input {...rName('first_name')} className="input" />
              {nameErrors.first_name && <p className="field-error">{nameErrors.first_name.message}</p>}
            </div>
            <div>
              <label className="label">Nom</label>
              <input {...rName('last_name')} className="input" />
              {nameErrors.last_name && <p className="field-error">{nameErrors.last_name.message}</p>}
            </div>
          </div>
          <button type="submit" disabled={nameMutation.isPending} className="btn-primary">
            {nameMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Enregistrer
          </button>
        </form>
      </div>

      {/* Change password */}
      <div className="card p-6">
        <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
          <Shield className="w-4 h-4 text-gray-400" />
          Changer le mot de passe
        </h3>
        <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
          <div>
            <label className="label">Mot de passe actuel</label>
            <input {...register('old_password')} type="password" className="input" />
            {errors.old_password && <p className="field-error">{errors.old_password.message}</p>}
          </div>
          <div>
            <label className="label">Nouveau mot de passe</label>
            <input {...register('new_password')} type="password" className="input" />
            {errors.new_password && <p className="field-error">{errors.new_password.message}</p>}
          </div>
          <div>
            <label className="label">Confirmer le mot de passe</label>
            <input {...register('confirm')} type="password" className="input" />
            {errors.confirm && <p className="field-error">{errors.confirm.message}</p>}
          </div>
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
            Mettre à jour
          </button>
        </form>
      </div>
    </div>
  );
}
