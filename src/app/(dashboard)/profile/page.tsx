'use client';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Loader2, Shield, User, Instagram, Facebook,
  Plus, Pencil, Trash2, ExternalLink, Eye, EyeOff, X, AtSign, Link as LinkIcon,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { authApi, usersApi, socialAccountsApi, SocialAccount, SocialAccountPayload, SocialPlatform } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import { getInitials } from '@/lib/utils';

/* ─── Social account mini-form ──────────────────────────────────── */

const PLAT = {
  instagram: { label: 'Instagram', Icon: Instagram, color: 'text-pink-600', bg: 'bg-pink-50', border: 'border-pink-200', bar: 'border-l-pink-400' },
  facebook:  { label: 'Facebook',  Icon: Facebook,  color: 'text-blue-600', bg: 'bg-blue-50',  border: 'border-blue-200',  bar: 'border-l-blue-400' },
} as const;

function SocialAccountForm({
  initial,
  defaultPlatform = 'instagram',
  onClose,
  onSaved,
}: {
  initial?: SocialAccount | null;
  defaultPlatform?: SocialPlatform;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const [form, setForm] = useState({
    platform:     (initial?.platform ?? defaultPlatform) as SocialPlatform,
    account_name: initial?.account_name ?? '',
    username:     initial?.username ?? '',
    login:        initial?.login ?? '',
    password:     initial?.password ?? '',
    url:          initial?.url ?? '',
    notes:        initial?.notes ?? '',
    assigned_to:  initial?.assigned_to ?? '',
  });
  const [showPwd, setShowPwd] = useState(false);

  const mutation = useMutation({
    mutationFn: () =>
      initial
        ? socialAccountsApi.update(initial.id, form)
        : socialAccountsApi.create(form as SocialAccountPayload),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-social-accounts'] }); onSaved(); },
    onError:   () => toast.error('Erreur lors de la sauvegarde'),
  });

  const set = (k: keyof typeof form) =>
    (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((f) => ({ ...f, [k]: e.target.value }));

  const cfg = PLAT[form.platform];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        <div className={`px-5 py-4 flex items-center justify-between ${cfg.bg} border-b ${cfg.border}`}>
          <div className="flex items-center gap-2">
            <cfg.Icon className={`w-4 h-4 ${cfg.color}`} />
            <h2 className="font-semibold text-sm text-gray-900">
              {initial ? 'Modifier le compte' : 'Ajouter un compte'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-black/10"><X className="w-4 h-4 text-gray-500" /></button>
        </div>
        <form onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }} className="p-5 space-y-3">
          {/* Platform toggle */}
          <div className="flex gap-2">
            {(['instagram', 'facebook'] as SocialPlatform[]).map((p) => {
              const c = PLAT[p];
              return (
                <button key={p} type="button"
                  onClick={() => setForm((f) => ({ ...f, platform: p }))}
                  className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-medium transition-colors ${
                    form.platform === p
                      ? `${p === 'instagram' ? 'bg-pink-600' : 'bg-blue-600'} text-white`
                      : 'bg-gray-50 text-gray-500 border border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  <c.Icon className="w-3.5 h-3.5" />{c.label}
                </button>
              );
            })}
          </div>

          <div>
            <label className="label text-xs">Nom du compte *</label>
            <input required type="text" value={form.account_name} onChange={set('account_name')}
              placeholder="Ex: Nordflam Officiel" className="input w-full text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs flex items-center gap-1"><AtSign className="w-3 h-3" />Identifiant</label>
              <input type="text" value={form.username} onChange={set('username')}
                placeholder="@compte" className="input w-full text-sm" />
            </div>
            <div>
              <label className="label text-xs flex items-center gap-1"><LinkIcon className="w-3 h-3" />URL profil</label>
              <input type="url" value={form.url} onChange={set('url')}
                placeholder="https://..." className="input w-full text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label text-xs">Email / Login</label>
              <input type="text" value={form.login} onChange={set('login')}
                placeholder="email@exemple.com" className="input w-full text-sm" />
            </div>
            <div>
              <label className="label text-xs">Mot de passe</label>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} value={form.password} onChange={set('password')}
                  placeholder="••••••••" className="input w-full text-sm pr-8" />
                <button type="button" onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>
          <div>
            <label className="label text-xs">Notes</label>
            <textarea value={form.notes} onChange={set('notes')} rows={2}
              placeholder="Infos supplémentaires..." className="input w-full text-sm resize-none" />
          </div>

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center text-sm">Annuler</button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1 justify-center text-sm">
              {mutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {initial ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SocialAccountCard({
  account,
  isOwner,
  onEdit,
  onDelete,
}: {
  account: SocialAccount;
  isOwner: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showPwd, setShowPwd] = useState(false);
  const cfg = PLAT[account.platform];
  return (
    <div className={`rounded-xl border border-gray-200 p-3 border-l-4 ${cfg.bar}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <cfg.Icon className={`w-4 h-4 ${cfg.color} flex-shrink-0`} />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="font-semibold text-gray-900 text-sm truncate">{account.account_name}</p>
              {!isOwner && (
                <span className="shrink-0 text-[10px] font-medium bg-indigo-50 text-indigo-600 rounded px-1.5 py-0.5">
                  Attribué par l'admin
                </span>
              )}
            </div>
            {account.username && <p className="text-xs text-gray-400">{account.username}</p>}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {account.url && (
            <a href={account.url} target="_blank" rel="noopener noreferrer"
              className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          {isOwner && (
            <>
              <button onClick={onEdit} className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600">
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button onClick={onDelete} className="p-1 rounded hover:bg-red-50 text-gray-400 hover:text-red-500">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>
      </div>

      {(account.login || account.password) && (
        <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs">
          {account.login && (
            <div>
              <p className="text-gray-400">Login</p>
              <p className="font-medium text-gray-700 truncate">{account.login}</p>
            </div>
          )}
          {account.password && (
            <div>
              <p className="text-gray-400">Mot de passe</p>
              <div className="flex items-center gap-1">
                <p className="font-medium text-gray-700 truncate">
                  {showPwd ? account.password : '••••••••'}
                </p>
                <button onClick={() => setShowPwd((v) => !v)} className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                  {showPwd ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      {account.notes && <p className="mt-1 text-xs text-gray-400 truncate">{account.notes}</p>}
    </div>
  );
}

function MySocialAccountsSection() {
  const qc = useQueryClient();
  const user = useAuthStore((s) => s.user);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<SocialAccount | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['my-social-accounts'],
    queryFn:  () => socialAccountsApi.getAll().then((r) => r.data),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => socialAccountsApi.delete(id),
    onSuccess:  () => { qc.invalidateQueries({ queryKey: ['my-social-accounts'] }); toast.success('Compte supprimé'); },
    onError:    () => toast.error('Erreur lors de la suppression'),
  });

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
          <div className="flex -space-x-1">
            <Instagram className="w-4 h-4 text-pink-500" />
            <Facebook className="w-4 h-4 text-blue-500" />
          </div>
          Mes comptes sociaux
        </h3>
        <button onClick={() => { setEditing(null); setShowForm(true); }} className="btn-primary py-1.5 px-3 text-xs gap-1">
          <Plus className="w-3.5 h-3.5" /> Ajouter
        </button>
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-400">Chargement…</p>
      ) : accounts.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-4">
          Aucun compte. Clique sur "Ajouter" pour enregistrer tes identifiants.
        </p>
      ) : (
        <div className="space-y-2">
          {accounts.map((a) => (
            <SocialAccountCard
              key={a.id}
              account={a}
              isOwner={a.created_by === user?.id}
              onEdit={() => { setEditing(a); setShowForm(true); }}
              onDelete={() => {
                if (confirm(`Supprimer "${a.account_name}" ?`)) deleteMutation.mutate(a.id);
              }}
            />
          ))}
        </div>
      )}

      {showForm && (
        <SocialAccountForm
          initial={editing}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}

/* ─── Name / password schemas ────────────────────────────────────── */

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

  const isAdmin = user?.role === 'admin';

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

      {/* Social accounts — setters only */}
      {!isAdmin && <MySocialAccountsSection />}

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
