'use client';
import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { shiftsApi, socialAccountsApi, usersApi, SocialAccount, SocialAccountPayload, SocialPlatform } from '@/lib/api';
import {
  Clock, UserCheck, UserX, Calendar, Timer,
  Instagram, Facebook, Plus, Pencil, Trash2, ExternalLink,
  X, Loader2, AtSign, Link, StickyNote, User, Eye, EyeOff,
  History, ChevronLeft, ChevronRight, Play, CheckCircle2, AlertCircle,
  Globe,
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

/* ─── Bot Instagram panel ─────────────────────────────────────────── */

function BotInstagramPanel() {
  const [launching, setLaunching] = useState(false);
  const [launchError, setLaunchError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ posts: number; usernames: number } | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const { data: status, refetch } = useQuery({
    queryKey: ['bot-instagram-status'],
    queryFn: () =>
      fetch('/api/bot/instagram/status', {
        headers: { Authorization: `Bearer ${localStorage.getItem('pf_token')}` },
      }).then((r) => r.json()),
    refetchInterval: (data: any) => (data?.status === 'running' ? 10_000 : false),
    staleTime: 5_000,
  });

  const isRunning = status?.status === 'running';

  async function launch() {
    setLaunching(true);
    setLaunchError(null);
    try {
      const res = await fetch('/api/bot/instagram/start', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('pf_token')}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Erreur');
      refetch();
    } catch (err: any) {
      setLaunchError(err.message);
    } finally {
      setLaunching(false);
    }
  }

  async function importLast() {
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const res = await fetch('/api/bot/instagram/import-last', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('pf_token')}` },
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Erreur');
      setImportResult(json);
      refetch();
    } catch (err: any) {
      setImportError(err.message);
    } finally {
      setImporting(false);
    }
  }

  function formatRelative(iso: string) {
    const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
    if (diff < 1) return 'à l\'instant';
    if (diff < 60) return `il y a ${diff} min`;
    const h = Math.floor(diff / 60);
    return `il y a ${h}h${diff % 60 > 0 ? ` ${diff % 60}min` : ''}`;
  }

  return (
    <section>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
          <Instagram className="w-4 h-4 text-pink-500" />
          Bot Instagram — Génération de leads
        </h2>
        <div className="flex items-center gap-2">
          <button
            onClick={importLast}
            disabled={importing || isRunning}
            className="btn-secondary py-1.5 px-3 text-xs gap-1.5 disabled:opacity-50"
          >
            {importing
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <CheckCircle2 className="w-3.5 h-3.5 text-pink-500" />}
            Importer le dernier dataset
          </button>
          <button
            onClick={launch}
            disabled={isRunning || launching}
            className="btn-primary py-1.5 px-3 text-xs gap-1.5 bg-pink-600 hover:bg-pink-700 disabled:opacity-50"
          >
            {launching || isRunning
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Play className="w-3.5 h-3.5" />}
            {isRunning ? 'En cours…' : 'Lancer le scraping'}
          </button>
        </div>
      </div>

      {launchError && (
        <div className="mb-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {launchError}
        </div>
      )}

      {importError && (
        <div className="mb-3 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          {importError}
        </div>
      )}

      {importResult && (
        <div className="mb-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm">
          <p className="font-semibold text-blue-800 mb-1">Profile scraper lancé</p>
          <p className="text-blue-700 text-xs">
            {importResult.posts} posts récupérés · <strong>{importResult.usernames} comptes</strong> envoyés au profile scraper Apify.
            Les leads apparaîtront ici dans 20-30 min.
          </p>
        </div>
      )}

      {!status ? (
        <div className="card p-6 text-center text-sm text-gray-400">
          Aucun scraping lancé. Clique sur "Lancer le scraping" pour démarrer.
        </div>
      ) : (
        <div className="card p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              {status.status === 'running' ? (
                <div className="w-10 h-10 rounded-xl bg-pink-50 flex items-center justify-center flex-shrink-0">
                  <Loader2 className="w-5 h-5 text-pink-500 animate-spin" />
                </div>
              ) : status.status === 'completed' ? (
                <div className="w-10 h-10 rounded-xl bg-green-50 flex items-center justify-center flex-shrink-0">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
              ) : (
                <div className="w-10 h-10 rounded-xl bg-red-50 flex items-center justify-center flex-shrink-0">
                  <AlertCircle className="w-5 h-5 text-red-500" />
                </div>
              )}
              <div>
                <p className="font-semibold text-gray-900 text-sm">
                  {status.status === 'running'  && 'Scraping en cours…'}
                  {status.status === 'completed' && 'Scraping terminé'}
                  {status.status === 'error'     && 'Erreur lors du scraping'}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  Lancé {formatRelative(status.started_at)}
                </p>
              </div>
            </div>

            {status.status === 'running' && (
              <div className="text-right flex-shrink-0">
                <p className="text-xs font-semibold text-pink-600">
                  {status.runs_done} / {status.runs_total} tâches
                </p>
                <div className="mt-1.5 w-32 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-pink-500 rounded-full transition-all duration-500"
                    style={{ width: status.runs_total > 0 ? `${(status.runs_done / status.runs_total) * 100}%` : '0%' }}
                  />
                </div>
              </div>
            )}
          </div>

          {status.status === 'completed' && (
            <div className="mt-4 pt-4 border-t border-gray-100 grid grid-cols-3 gap-3 text-center text-xs">
              <div>
                <p className="text-2xl font-bold text-gray-900">{status.leads_inserted}</p>
                <p className="text-gray-400 mt-0.5">Leads ajoutés</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-gray-900">{status.leads_updated}</p>
                <p className="text-gray-400 mt-0.5">Leads mis à jour</p>
              </div>
              <div>
                <p className="text-2xl font-bold text-indigo-600">
                  {status.leads_inserted + status.leads_updated}
                </p>
                <p className="text-gray-400 mt-0.5">Total traités</p>
              </div>
            </div>
          )}

          {status.error_message && (
            <p className="mt-3 text-xs text-red-500 bg-red-50 rounded px-3 py-2">
              {status.error_message}
            </p>
          )}
        </div>
      )}
    </section>
  );
}

/* ─── Shift history modal ─────────────────────────────────────────── */

function ShiftHistoryModal({ onClose }: { onClose: () => void }) {
  const thirtyDaysAgo = (() => {
    const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10);
  })();
  const [start, setStart] = useState(thirtyDaysAgo);
  const [end,   setEnd]   = useState(new Date().toISOString().slice(0, 10));

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['shifts-history', start, end],
    queryFn:  () =>
      fetch(`/api/shifts/history?start=${start}&end=${end}`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('pf_token')}` },
      }).then((r) => r.json()),
    staleTime: 60_000,
  });

  const byDay = (history as any[]).reduce((acc: Record<string, any[]>, shift) => {
    const day = shift.started_at.slice(0, 10);
    if (!acc[day]) acc[day] = [];
    acc[day].push(shift);
    return acc;
  }, {});

  const days = Object.keys(byDay).sort((a, b) => b.localeCompare(a));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-2">
            <History className="w-5 h-5 text-indigo-500" />
            <h2 className="font-bold text-gray-900">Historique des shifts</h2>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Filters */}
        <div className="px-6 py-3 border-b border-gray-100 flex items-center gap-3 flex-shrink-0">
          <span className="text-xs text-gray-500 font-medium">Période :</span>
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)}
            className="input py-1 text-sm w-auto" />
          <span className="text-xs text-gray-400">→</span>
          <input type="date" value={end} max={new Date().toISOString().slice(0, 10)}
            onChange={(e) => setEnd(e.target.value)}
            className="input py-1 text-sm w-auto" />
          <span className="text-xs text-gray-400 ml-auto">
            {(history as any[]).length} shift{(history as any[]).length !== 1 ? 's' : ''}
          </span>
        </div>

        {/* Table */}
        <div className="overflow-y-auto flex-1">
          {isLoading ? (
            <div className="flex items-center justify-center h-40">
              <Loader2 className="w-6 h-6 text-indigo-500 animate-spin" />
            </div>
          ) : days.length === 0 ? (
            <div className="flex items-center justify-center h-40 text-sm text-gray-400">
              Aucun shift sur cette période.
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-gray-50 z-10">
                <tr className="border-b border-gray-200 text-xs text-gray-500 font-medium">
                  <th className="text-left px-6 py-3">Date</th>
                  <th className="text-left px-4 py-3">Setter</th>
                  <th className="text-left px-4 py-3">Début</th>
                  <th className="text-left px-4 py-3">Fin</th>
                  <th className="text-left px-4 py-3">Durée</th>
                  <th className="text-center px-4 py-3">Appels</th>
                  <th className="text-center px-4 py-3">RDV</th>
                  <th className="text-center px-4 py-3">Clients</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => {
                  const dayShifts = byDay[day];
                  const label = new Date(day + 'T12:00:00').toLocaleDateString('fr-FR', {
                    weekday: 'long', day: 'numeric', month: 'long',
                  });
                  return dayShifts.map((shift: any, i: number) => (
                    <tr key={shift.id} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                      {/* Date cell — affiché seulement sur la première ligne du groupe */}
                      <td className="px-6 py-3 align-top">
                        {i === 0 ? (
                          <span className="font-semibold text-gray-700 capitalize text-xs">{label}</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                            {getInitials(shift.first_name ?? '?', shift.last_name ?? '')}
                          </div>
                          <span className="font-medium text-gray-900 whitespace-nowrap">
                            {shift.first_name} {shift.last_name}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 tabular-nums text-gray-600">{formatTime(shift.started_at)}</td>
                      <td className="px-4 py-3 tabular-nums text-gray-600">
                        {shift.ended_at ? formatTime(shift.ended_at) : (
                          <span className="text-green-600 font-medium flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
                            En cours
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className="font-semibold text-indigo-600 tabular-nums">
                          {shift.ended_at ? formatDuration(shift.started_at, shift.ended_at) : (
                            <LiveDuration startedAt={shift.started_at} />
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold tabular-nums ${(shift.leads_called ?? 0) > 0 ? 'text-gray-900' : 'text-gray-300'}`}>
                          {shift.leads_called ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold tabular-nums ${(shift.appointments ?? 0) > 0 ? 'text-amber-600' : 'text-gray-300'}`}>
                          {shift.appointments ?? 0}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`font-bold tabular-nums ${(shift.clients ?? 0) > 0 ? 'text-green-600' : 'text-gray-300'}`}>
                          {shift.clients ?? 0}
                        </span>
                      </td>
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
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
  const [showHistory, setShowHistory] = useState(false);

  const { data: shifts = [], isLoading } = useQuery({
    queryKey:        ['shifts', selectedDate],
    queryFn:         () => shiftsApi.list(selectedDate).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const active    = shifts.filter((s: any) => !s.ended_at);
  const completed = shifts.filter((s: any) => !!s.ended_at);

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="space-y-8">

      {showHistory && <ShiftHistoryModal onClose={() => setShowHistory(false)} />}

      {/* ── Shift tracking section ───────────────────────────────── */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Clock className="w-5 h-5 text-indigo-500" />
            <h1 className="text-base font-bold text-gray-900">Suivi des shifts</h1>
          </div>
          <button
            onClick={() => setShowHistory(true)}
            className="btn-secondary py-1.5 px-3 text-xs gap-1.5"
          >
            <History className="w-3.5 h-3.5" />
            Historique
          </button>
        </div>

        {/* Date picker */}
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="input py-1.5 text-sm w-auto"
          />
          {selectedDate === new Date().toISOString().slice(0, 10) && (
            <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
              Temps réel · actualisation toutes les 30s
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
                      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs text-gray-500">
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
                        <th className="text-left px-4 py-3">Durée totale</th>
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
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* Stats */}
            {shifts.length > 0 && (
              <section className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Total pointages',   value: shifts.length,    icon: <Clock className="w-4 h-4 text-indigo-500" />, bg: 'bg-indigo-50' },
                  { label: 'En ligne maintenant', value: active.length,  icon: <UserCheck className="w-4 h-4 text-green-500" />, bg: 'bg-green-50' },
                  { label: 'Shifts terminés',   value: completed.length, icon: <UserX className="w-4 h-4 text-gray-400" />, bg: 'bg-gray-50' },
                ].map(({ label, value, icon, bg }) => (
                  <div key={label} className={`card p-4 ${bg}`}>
                    <div className="flex items-center gap-2 mb-1">{icon}<p className="text-xs text-gray-500">{label}</p></div>
                    <p className="text-2xl font-bold text-gray-900">{value}</p>
                  </div>
                ))}
              </section>
            )}
          </>
        )}
      </div>

      {/* ── Divider ──────────────────────────────────────────────── */}
      <div className="border-t border-gray-200" />

      {/* ── Outils ───────────────────────────────────────────────── */}
      <section>
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Outils</h2>
        <button
          onClick={() => router.push('/admin/csv-filter')}
          className="card p-4 flex items-center gap-3 w-full text-left hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
        >
          <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
            <Globe className="w-5 h-5 text-indigo-500" />
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-gray-900 text-sm">Filtrer les leads sans site web</p>
            <p className="text-xs text-gray-500">
              Importe un CSV scrappé et récupère uniquement les lignes sans site web.
            </p>
          </div>
        </button>
      </section>

      {/* ── Divider ──────────────────────────────────────────────── */}
      <div className="border-t border-gray-200" />

      {/* ── Bot Instagram ─────────────────────────────────────────── */}
      <BotInstagramPanel />

      {/* ── Divider ──────────────────────────────────────────────── */}
      <div className="border-t border-gray-200" />

      {/* ── Social accounts section ───────────────────────────────── */}
      <div className="space-y-1">
        <SocialAccountsSection />
      </div>

    </div>
  );
}
