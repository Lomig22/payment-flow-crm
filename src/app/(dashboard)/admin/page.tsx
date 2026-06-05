'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { shiftsApi, socialAccountsApi, usersApi, SocialAccount, SocialAccountPayload, SocialPlatform } from '@/lib/api';
import {
  Clock, UserCheck, UserX, Calendar, Timer,
  Instagram, Facebook, Plus, Pencil, Trash2, ExternalLink,
  X, Loader2, AtSign, Link, StickyNote, User, Eye, EyeOff,
  PhoneCall, CalendarCheck, Trophy, ChevronLeft, ChevronRight,
} from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { useRouter } from 'next/navigation';

/* ─── Helpers ─────────────────────────────────────────────────────── */

function formatDuration(startedAt: string, endedAt?: string | null): string {
  const start = new Date(startedAt).getTime();
  const end   = endedAt ? new Date(endedAt).getTime() : Date.now();
  const total = Math.floor((end - start) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}min`;
  if (m > 0) return `${m}min ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

function LiveDuration({ startedAt }: { startedAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{formatDuration(startedAt)}</>;
}

/* ─── Platform config ─────────────────────────────────────────────── */

const PLATFORM_CONFIG = {
  instagram: {
    label:  'Instagram',
    icon:   Instagram,
    color:  'text-pink-600',
    bg:     'bg-pink-50',
    border: 'border-pink-200',
    tab:    'bg-pink-600 text-white',
    tabInactive: 'text-pink-600 hover:bg-pink-50 border border-pink-200',
    badge:  'bg-pink-100 text-pink-700',
  },
  facebook: {
    label:  'Facebook',
    icon:   Facebook,
    color:  'text-blue-600',
    bg:     'bg-blue-50',
    border: 'border-blue-200',
    tab:    'bg-blue-600 text-white',
    tabInactive: 'text-blue-600 hover:bg-blue-50 border border-blue-200',
    badge:  'bg-blue-100 text-blue-700',
  },
} as const;

/* ─── Account form modal ──────────────────────────────────────────── */

interface AccountFormProps {
  initial?: SocialAccount | null;
  defaultPlatform?: SocialPlatform;
  onClose: () => void;
  onSaved: () => void;
}

function AccountForm({ initial, defaultPlatform = 'instagram', onClose, onSaved }: AccountFormProps) {
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

  const { data: setters = [] } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: () =>
      initial
        ? socialAccountsApi.update(initial.id, form)
        : socialAccountsApi.create(form as SocialAccountPayload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['social-accounts'] });
      onSaved();
    },
  });

  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const cfg = PLATFORM_CONFIG[form.platform];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md overflow-hidden">
        {/* Header */}
        <div className={`px-6 py-4 flex items-center justify-between ${cfg.bg} border-b ${cfg.border}`}>
          <div className="flex items-center gap-2">
            <cfg.icon className={`w-5 h-5 ${cfg.color}`} />
            <h2 className="font-semibold text-gray-900">
              {initial ? 'Modifier le compte' : 'Ajouter un compte'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-black/10 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <form
          onSubmit={(e) => { e.preventDefault(); mutation.mutate(); }}
          className="p-6 space-y-4"
        >
          {/* Platform */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Plateforme</label>
            <div className="flex gap-2">
              {(['instagram', 'facebook'] as SocialPlatform[]).map((p) => {
                const c = PLATFORM_CONFIG[p];
                return (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setForm((f) => ({ ...f, platform: p }))}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-sm font-medium transition-colors ${
                      form.platform === p ? c.tab : `bg-gray-50 text-gray-500 hover:bg-gray-100 border border-gray-200`
                    }`}
                  >
                    <c.icon className="w-4 h-4" />
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Account name */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              <User className="w-3.5 h-3.5 inline mr-1" />Nom du compte *
            </label>
            <input
              required
              type="text"
              value={form.account_name}
              onChange={set('account_name')}
              placeholder="Ex: Nordflam Officiel"
              className="input w-full"
            />
          </div>

          {/* Username */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              <AtSign className="w-3.5 h-3.5 inline mr-1" />Identifiant (@username)
            </label>
            <input
              type="text"
              value={form.username}
              onChange={set('username')}
              placeholder="@mon_compte"
              className="input w-full"
            />
          </div>

          {/* URL */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              <Link className="w-3.5 h-3.5 inline mr-1" />Lien du profil
            </label>
            <input
              type="url"
              value={form.url}
              onChange={set('url')}
              placeholder="https://instagram.com/..."
              className="input w-full"
            />
          </div>

          {/* Login + Password */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Email / Login</label>
              <input type="text" value={form.login} onChange={set('login')}
                placeholder="email@exemple.com" className="input w-full" />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Mot de passe</label>
              <div className="relative">
                <input type={showPwd ? 'text' : 'password'} value={form.password} onChange={set('password')}
                  placeholder="••••••••" className="input w-full pr-8" />
                <button type="button" onClick={() => setShowPwd((v) => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPwd ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Assigned to */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              <User className="w-3.5 h-3.5 inline mr-1" />Attribué à
            </label>
            <select
              value={form.assigned_to}
              onChange={set('assigned_to')}
              className="select w-full"
            >
              <option value="">— Non assigné —</option>
              {(setters as any[]).map((s) => (
                <option key={s.id} value={`${s.first_name} ${s.last_name}`}>
                  {s.first_name} {s.last_name}
                </option>
              ))}
            </select>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              <StickyNote className="w-3.5 h-3.5 inline mr-1" />Notes
            </label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              rows={2}
              placeholder="Infos supplémentaires..."
              className="input w-full resize-none"
            />
          </div>

          {mutation.isError && (
            <p className="text-sm text-red-600">Une erreur est survenue. Réessaie.</p>
          )}

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose} className="btn-secondary flex-1 justify-center">
              Annuler
            </button>
            <button type="submit" disabled={mutation.isPending} className="btn-primary flex-1 justify-center">
              {mutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {initial ? 'Enregistrer' : 'Ajouter'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Account card ────────────────────────────────────────────────── */

function AccountCard({
  account,
  onEdit,
  onDelete,
}: {
  account: SocialAccount;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showPwd, setShowPwd] = useState(false);
  const cfg = PLATFORM_CONFIG[account.platform];
  return (
    <div className={`card p-4 border-l-4 ${account.platform === 'instagram' ? 'border-l-pink-400' : 'border-l-blue-400'}`}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className={`w-9 h-9 rounded-xl ${cfg.bg} flex items-center justify-center flex-shrink-0`}>
            <cfg.icon className={`w-5 h-5 ${cfg.color}`} />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm truncate">{account.account_name}</p>
            {account.username && (
              <p className="text-xs text-gray-400 truncate">{account.username}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {account.url && (
            <a href={account.url} target="_blank" rel="noopener noreferrer"
              className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600">
              <ExternalLink className="w-3.5 h-3.5" />
            </a>
          )}
          <button onClick={onEdit}
            className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={onDelete}
            className="p-1.5 rounded-lg hover:bg-red-50 transition-colors text-gray-400 hover:text-red-500">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Credentials */}
      {(account.login || account.password) && (
        <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs">
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
                <p className="font-mono font-medium text-gray-700 truncate">
                  {showPwd ? account.password : '••••••••'}
                </p>
                <button onClick={() => setShowPwd((v) => !v)}
                  className="text-gray-400 hover:text-gray-600 flex-shrink-0">
                  {showPwd ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {(account.assigned_to || account.notes) && (
        <div className="mt-2 pt-2 border-t border-gray-100 space-y-1">
          {account.assigned_to && (
            <p className="text-xs text-gray-500 flex items-center gap-1">
              <User className="w-3 h-3 text-gray-400" />
              <span className="font-medium text-gray-700">{account.assigned_to}</span>
            </p>
          )}
          {account.notes && (
            <p className="text-xs text-gray-500 line-clamp-2">{account.notes}</p>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Social accounts section ─────────────────────────────────────── */

function SocialAccountsSection() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<'all' | SocialPlatform>('all');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<SocialAccount | null>(null);

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ['social-accounts'],
    queryFn:  () => socialAccountsApi.getAll().then((r) => r.data),
    staleTime: 60_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => socialAccountsApi.delete(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['social-accounts'] }),
  });

  const filtered = tab === 'all' ? accounts : accounts.filter((a) => a.platform === tab);

  const igCount = accounts.filter((a) => a.platform === 'instagram').length;
  const fbCount = accounts.filter((a) => a.platform === 'facebook').length;

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <div className="flex -space-x-1">
            <Instagram className="w-4 h-4 text-pink-500" />
            <Facebook className="w-4 h-4 text-blue-500" />
          </div>
          Comptes réseaux sociaux
          <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-medium">
            {accounts.length}
          </span>
        </h2>
        <button
          onClick={() => { setEditing(null); setShowForm(true); }}
          className="btn-primary py-1.5 px-3 text-xs gap-1"
        >
          <Plus className="w-3.5 h-3.5" /> Ajouter
        </button>
      </div>

      {/* Platform tabs */}
      <div className="flex gap-2 mb-4">
        <button
          onClick={() => setTab('all')}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tab === 'all'
              ? 'bg-gray-800 text-white'
              : 'text-gray-600 hover:bg-gray-100 border border-gray-200'
          }`}
        >
          Tous ({accounts.length})
        </button>
        <button
          onClick={() => setTab('instagram')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tab === 'instagram'
              ? PLATFORM_CONFIG.instagram.tab
              : PLATFORM_CONFIG.instagram.tabInactive
          }`}
        >
          <Instagram className="w-3.5 h-3.5" /> Instagram ({igCount})
        </button>
        <button
          onClick={() => setTab('facebook')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
            tab === 'facebook'
              ? PLATFORM_CONFIG.facebook.tab
              : PLATFORM_CONFIG.facebook.tabInactive
          }`}
        >
          <Facebook className="w-3.5 h-3.5" /> Facebook ({fbCount})
        </button>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-8">
          <Spinner className="w-6 h-6" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="card p-8 text-center text-sm text-gray-400">
          {tab === 'all'
            ? 'Aucun compte ajouté. Clique sur "Ajouter" pour commencer.'
            : `Aucun compte ${PLATFORM_CONFIG[tab].label} enregistré.`}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              onEdit={() => { setEditing(account); setShowForm(true); }}
              onDelete={() => {
                if (confirm(`Supprimer "${account.account_name}" ?`)) {
                  deleteMutation.mutate(account.id);
                }
              }}
            />
          ))}
        </div>
      )}

      {showForm && (
        <AccountForm
          initial={editing}
          defaultPlatform={tab === 'all' ? 'instagram' : tab}
          onClose={() => { setShowForm(false); setEditing(null); }}
          onSaved={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </section>
  );
}

/* ─── Main page ───────────────────────────────────────────────────── */

export default function RessourcesPage() {
  const user   = useAuthStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== 'admin') router.replace('/ressources');
  }, [user, router]);

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const { data: shifts = [], isLoading } = useQuery({
    queryKey:        ['shifts', selectedDate],
    queryFn:         () => shiftsApi.list(selectedDate).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const active    = shifts.filter((s: any) => !s.ended_at);
  const completed = shifts.filter((s: any) => !!s.ended_at);

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="space-y-8 max-w-5xl">

      {/* ── Shift tracking section ───────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <Clock className="w-5 h-5 text-indigo-500" />
          <h1 className="text-base font-bold text-gray-900">Suivi des shifts</h1>
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedDate(d => {
              const prev = new Date(d); prev.setDate(prev.getDate() - 1);
              return prev.toISOString().slice(0, 10);
            })}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-400" />
            <input
              type="date"
              value={selectedDate}
              onChange={(e) => setSelectedDate(e.target.value)}
              className="input py-1.5 text-sm w-auto"
            />
          </div>
          <button
            onClick={() => setSelectedDate(d => {
              const next = new Date(d); next.setDate(next.getDate() + 1);
              return next.toISOString().slice(0, 10);
            })}
            disabled={selectedDate >= new Date().toISOString().slice(0, 10)}
            className="p-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
          {selectedDate === new Date().toISOString().slice(0, 10) && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
              Temps réel · 30s
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center h-32">
            <Spinner className="w-8 h-8" />
          </div>
        ) : (
          <>
            {/* Active shifts */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <UserCheck className="w-4 h-4 text-green-500" />
                Actuellement connectés
                <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                  {active.length}
                </span>
              </h2>
              {active.length === 0 ? (
                <div className="card p-6 text-center text-sm text-gray-400">
                  Personne n'est connecté en ce moment.
                </div>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {active.map((shift: any) => (
                    <div key={shift.id} className="card p-4 border-l-4 border-l-green-400">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {getInitials(shift.first_name ?? '?', shift.last_name ?? '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">
                            {shift.first_name} {shift.last_name}
                          </p>
                          <p className="text-xs text-gray-400 capitalize">{shift.role}</p>
                        </div>
                        <span className="w-2.5 h-2.5 bg-green-400 rounded-full flex-shrink-0 animate-pulse" />
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <p className="text-gray-400">Arrivée</p>
                          <p className="font-semibold text-gray-700">{formatTime(shift.started_at)}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Durée</p>
                          <p className="font-semibold text-indigo-600">
                            <LiveDuration startedAt={shift.started_at} />
                          </p>
                        </div>
                      </div>
                      <div className="mt-2 pt-2 border-t border-gray-100 grid grid-cols-3 gap-1 text-xs text-center">
                        <div className="bg-blue-50 rounded-lg py-1.5">
                          <p className="font-bold text-blue-700 text-base leading-tight">{shift.leads_called ?? 0}</p>
                          <p className="text-blue-500 flex items-center justify-center gap-0.5">
                            <PhoneCall className="w-2.5 h-2.5" /> Appels
                          </p>
                        </div>
                        <div className="bg-amber-50 rounded-lg py-1.5">
                          <p className="font-bold text-amber-700 text-base leading-tight">{shift.appointments ?? 0}</p>
                          <p className="text-amber-500 flex items-center justify-center gap-0.5">
                            <CalendarCheck className="w-2.5 h-2.5" /> RDV
                          </p>
                        </div>
                        <div className="bg-green-50 rounded-lg py-1.5">
                          <p className="font-bold text-green-700 text-base leading-tight">{shift.clients ?? 0}</p>
                          <p className="text-green-500 flex items-center justify-center gap-0.5">
                            <Trophy className="w-2.5 h-2.5" /> Clients
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Completed shifts */}
            <section>
              <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                <Timer className="w-4 h-4 text-gray-400" />
                Shifts terminés
                <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-medium">
                  {completed.length}
                </span>
              </h2>
              {completed.length === 0 ? (
                <div className="card p-6 text-center text-sm text-gray-400">
                  Aucun shift terminé pour cette date.
                </div>
              ) : (
                <div className="card overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-100 text-xs text-gray-500 font-medium">
                        <th className="text-left px-4 py-3">Membre</th>
                        <th className="text-left px-4 py-3">Arrivée</th>
                        <th className="text-left px-4 py-3">Départ</th>
                        <th className="text-left px-4 py-3">Durée</th>
                        <th className="text-center px-3 py-3">
                          <span className="flex items-center justify-center gap-1 text-blue-500">
                            <PhoneCall className="w-3 h-3" /> Appels
                          </span>
                        </th>
                        <th className="text-center px-3 py-3">
                          <span className="flex items-center justify-center gap-1 text-amber-500">
                            <CalendarCheck className="w-3 h-3" /> RDV
                          </span>
                        </th>
                        <th className="text-center px-3 py-3">
                          <span className="flex items-center justify-center gap-1 text-green-500">
                            <Trophy className="w-3 h-3" /> Clients
                          </span>
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {completed.map((shift: any) => (
                          <tr key={shift.id} className="hover:bg-gray-50 transition-colors">
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                  {getInitials(shift.first_name ?? '?', shift.last_name ?? '')}
                                </div>
                                <div>
                                  <p className="font-medium text-gray-900">
                                    {shift.first_name} {shift.last_name}
                                  </p>
                                  <p className="text-xs text-gray-400 capitalize">{shift.role}</p>
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3 text-gray-700 tabular-nums">{formatTime(shift.started_at)}</td>
                            <td className="px-4 py-3 text-gray-700 tabular-nums">
                              {shift.ended_at ? formatTime(shift.ended_at) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <span className="font-semibold text-indigo-600">
                                {shift.ended_at ? formatDuration(shift.started_at, shift.ended_at) : '—'}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`font-bold ${shift.leads_called > 0 ? 'text-blue-700' : 'text-gray-300'}`}>
                                {shift.leads_called ?? 0}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`font-bold ${shift.appointments > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                                {shift.appointments ?? 0}
                              </span>
                            </td>
                            <td className="px-3 py-3 text-center">
                              <span className={`font-bold ${shift.clients > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                                {shift.clients ?? 0}
                              </span>
                            </td>
                          </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Totaux journée */}
            {shifts.length > 0 && (() => {
              const totalCalls   = shifts.reduce((s: number, sh: any) => s + (sh.leads_called ?? 0), 0);
              const totalRdv     = shifts.reduce((s: number, sh: any) => s + (sh.appointments ?? 0), 0);
              const totalClients = shifts.reduce((s: number, sh: any) => s + (sh.clients ?? 0), 0);
              const totalTime    = completed.reduce((s: number, sh: any) => {
                if (!sh.ended_at) return s;
                return s + (new Date(sh.ended_at).getTime() - new Date(sh.started_at).getTime());
              }, 0);
              const totalHours = Math.floor(totalTime / 3600000);
              const totalMins  = Math.floor((totalTime % 3600000) / 60000);
              return (
                <section>
                  <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
                    <Trophy className="w-4 h-4 text-amber-500" />
                    Totaux de la journée
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                    <div className="card p-4 bg-indigo-50">
                      <div className="flex items-center gap-2 mb-1">
                        <Clock className="w-4 h-4 text-indigo-500" />
                        <p className="text-xs text-gray-500">Temps total</p>
                      </div>
                      <p className="text-2xl font-bold text-indigo-700">
                        {totalHours > 0 ? `${totalHours}h${totalMins.toString().padStart(2,'0')}` : `${totalMins}min`}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">{shifts.length} shift{shifts.length > 1 ? 's' : ''}</p>
                    </div>
                    <div className="card p-4 bg-blue-50">
                      <div className="flex items-center gap-2 mb-1">
                        <PhoneCall className="w-4 h-4 text-blue-500" />
                        <p className="text-xs text-gray-500">Appels passés</p>
                      </div>
                      <p className="text-2xl font-bold text-blue-700">{totalCalls}</p>
                      <p className="text-xs text-gray-400 mt-0.5">leads contactés</p>
                    </div>
                    <div className="card p-4 bg-amber-50">
                      <div className="flex items-center gap-2 mb-1">
                        <CalendarCheck className="w-4 h-4 text-amber-500" />
                        <p className="text-xs text-gray-500">RDV pris</p>
                      </div>
                      <p className="text-2xl font-bold text-amber-700">{totalRdv}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {totalCalls > 0 ? `${Math.round(totalRdv / totalCalls * 100)}% de conversion` : '—'}
                      </p>
                    </div>
                    <div className="card p-4 bg-green-50">
                      <div className="flex items-center gap-2 mb-1">
                        <Trophy className="w-4 h-4 text-green-500" />
                        <p className="text-xs text-gray-500">Clients signés</p>
                      </div>
                      <p className="text-2xl font-bold text-green-700">{totalClients}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {totalRdv > 0 ? `${Math.round(totalClients / totalRdv * 100)}% closing` : '—'}
                      </p>
                    </div>
                  </div>
                </section>
              );
            })()}
          </>
        )}
      </div>

      {/* ── Divider ──────────────────────────────────────────────── */}
      <div className="border-t border-gray-200" />

      {/* ── Social accounts section ───────────────────────────────── */}
      <div className="space-y-1">
        <SocialAccountsSection />
      </div>

    </div>
  );
}
