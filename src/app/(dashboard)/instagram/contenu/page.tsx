'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  RefreshCw, Film, CircleDot, Image as ImageIcon, Layers, Eye, Users, UserSearch,
  Heart, MousePointerClick, UserPlus, ExternalLink, Target, AlertTriangle, Check, Pencil,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { contentApi, type ContentFormat, type IgContentItem } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Spinner from '@/components/ui/Spinner';
import StatCard from '@/components/ui/StatCard';
import InboundPanel from '@/components/dashboard/InboundPanel';

const FORMAT_META: Record<ContentFormat, { label: string; plural: string; icon: React.ElementType; badge: string }> = {
  reel:     { label: 'Reel',      plural: 'Reels',      icon: Film,      badge: 'bg-pink-100 text-pink-700' },
  story:    { label: 'Story',     plural: 'Stories',    icon: CircleDot, badge: 'bg-amber-100 text-amber-700' },
  post:     { label: 'Post',      plural: 'Posts',      icon: ImageIcon, badge: 'bg-blue-100 text-blue-700' },
  carousel: { label: 'Carrousel', plural: 'Carrousels', icon: Layers,    badge: 'bg-violet-100 text-violet-700' },
};
const FORMATS = Object.keys(FORMAT_META) as ContentFormat[];

type SortKey = 'recent' | 'views' | 'total_interactions' | 'leads';

// Synchro auto à l'ouverture si la dernière date de plus de 30 min
const STALE_MS = 30 * 60_000;

const fmt = (n: number | null | undefined) => (n == null ? '—' : n.toLocaleString('fr-FR'));
const fmtTime = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtDay = (day: string, i: number) =>
  i === 0 ? "Aujourd'hui" : i === 1 ? 'Hier'
  : new Date(`${day}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });

function TargetCard({ format, done, target, canEdit, onSave }: {
  format: ContentFormat; done: number; target: number; canEdit: boolean; onSave: (n: number) => void;
}) {
  const { plural, icon: Icon } = FORMAT_META[format];
  const [editing, setEditing] = useState(false);
  const [value, setValue]     = useState(String(target));
  const pct  = target > 0 ? Math.min(100, Math.round((done / target) * 100)) : 0;
  const met  = target > 0 && done >= target;

  return (
    <div className="card p-5">
      <div className="flex items-center gap-2 mb-3">
        <Icon className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">{plural} aujourd&apos;hui</p>
        {canEdit && !editing && (
          <button onClick={() => { setValue(String(target)); setEditing(true); }}
            className="ml-auto p-1 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100" title="Modifier l'objectif">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-3xl font-bold ${met ? 'text-green-600' : 'text-gray-900'}`}>{done}</span>
        {editing ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); onSave(Number(value)); setEditing(false); }}>
            <span className="text-lg text-gray-400">/</span>
            <input type="number" min={0} max={100} value={value} onChange={(e) => setValue(e.target.value)}
              className="input w-20 py-1 text-sm" autoFocus />
            <button type="submit" className="btn-primary btn-sm"><Check className="w-3.5 h-3.5" /></button>
          </form>
        ) : (
          <span className="text-lg text-gray-400">/ {target}</span>
        )}
      </div>
      <div className="mt-3 h-2 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full rounded-full transition-all ${met ? 'bg-green-500' : 'bg-primary-600'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="mt-2 text-xs text-gray-500">
        {target === 0 ? 'Pas d’objectif' : met ? 'Objectif atteint ✅' : `Encore ${target - done} à publier`}
      </p>
    </div>
  );
}

export default function ContenuInstagramPage() {
  const qc      = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const [filter, setFilter] = useState<ContentFormat | 'all'>('all');
  const [sort, setSort]     = useState<SortKey>('recent');
  const autoSynced = useRef(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['instagram-content'],
    queryFn:  () => contentApi.overview().then((r) => r.data),
    enabled:  isAdmin,
  });

  const sync = useMutation({
    mutationFn: () => contentApi.sync().then((r) => r.data),
    onSuccess:  (res) => {
      qc.invalidateQueries({ queryKey: ['instagram-content'] });
      const errors = res.flatMap((r) => r.errors);
      if (errors.length) toast.error(`Synchro partielle : ${errors[0]}`);
      else toast.success(`Synchro OK : ${res.reduce((s, r) => s + r.media, 0)} contenus à jour`);
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Synchro impossible'),
  });

  const setTarget = useMutation({
    mutationFn: ({ format, per_day }: { format: ContentFormat; per_day: number }) =>
      contentApi.setTarget(data!.account, format, per_day),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['instagram-content'] }); toast.success('Objectif mis à jour'); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });

  useEffect(() => {
    if (!data || autoSynced.current) return;
    const last = data.sync?.last_sync_at ? new Date(data.sync.last_sync_at).getTime() : 0;
    if (Date.now() - last > STALE_MS) {
      autoSynced.current = true;
      sync.mutate();
    }
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const items = useMemo(() => {
    const list = (data?.content ?? []).filter((c) => filter === 'all' || c.format === filter);
    if (sort === 'recent') return list;
    return [...list].sort((a, b) => (b[sort] ?? 0) - (a[sort] ?? 0));
  }, [data, filter, sort]);

  if (!isAdmin) {
    return <div className="card p-8 text-center text-gray-500">Page réservée aux administrateurs.</div>;
  }
  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8" /></div>;
  }
  if (error || !data) {
    return <div className="card p-8 text-center text-gray-500">Impossible de charger le contenu Instagram.</div>;
  }

  const { today, targets, history, account_daily: daily } = data;
  const shownFormats = FORMATS.filter((f) => (targets[f] ?? 0) > 0 || today[f] > 0);
  const igToday     = daily[0];
  const igYesterday = daily[1];
  const tokenDays = data.sync?.token_expires_at
    ? Math.floor((new Date(data.sync.token_expires_at).getTime() - Date.now()) / 86_400_000) : null;

  return (
    <div className="space-y-6">
      {/* En-tête compte + synchro */}
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <p className="text-sm font-semibold text-gray-900">@{data.account}</p>
          <p className="text-xs text-gray-500">
            {data.sync?.last_sync_at
              ? `Dernière synchro : ${new Date(data.sync.last_sync_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', dateStyle: 'short', timeStyle: 'short' })}`
              : 'Jamais synchronisé'}
          </p>
        </div>
        <button onClick={() => sync.mutate()} disabled={sync.isPending} className="btn-secondary btn-sm ml-auto">
          <RefreshCw className={`w-3.5 h-3.5 ${sync.isPending ? 'animate-spin' : ''}`} />
          {sync.isPending ? 'Synchro…' : 'Synchroniser'}
        </button>
      </div>

      {data.sync?.last_sync_error && (
        <div className="card p-3 flex items-start gap-2 text-sm text-orange-700 bg-orange-50 border-orange-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          Dernière synchro incomplète : {data.sync.last_sync_error}
        </div>
      )}
      {tokenDays != null && tokenDays < 10 && (
        <div className="card p-3 flex items-start gap-2 text-sm text-red-700 bg-red-50 border-red-200">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          Le token Instagram expire dans {tokenDays} jour(s) et n&apos;a pas pu être prolongé : générez-en un nouveau dans l&apos;app Meta.
        </div>
      )}

      {/* Objectifs du jour */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
          <Target className="w-3.5 h-3.5" /> Objectifs du jour
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {shownFormats.map((f) => (
            <TargetCard key={f} format={f} done={today[f]} target={targets[f] ?? 0} canEdit={isAdmin}
              onSave={(n) => setTarget.mutate({ format: f, per_day: n })} />
          ))}
        </div>
      </div>

      {/* Stats du compte */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Compte — aujourd&apos;hui{igYesterday ? ` (hier : ${fmt(igYesterday.views)} vues, ${fmt(igYesterday.profile_views)} visites du profil)` : ''}
        </p>
        <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          <StatCard title="Vues"               value={fmt(igToday?.views)}              icon={Eye}               color="purple" />
          <StatCard title="Comptes touchés"    value={fmt(igToday?.reach)}              icon={Users}             color="blue" />
          <StatCard title="Visites du profil"  value={fmt(igToday?.profile_views)}      icon={UserSearch}        color="orange" />
          <StatCard title="Interactions"       value={fmt(igToday?.total_interactions)} icon={Heart}             color="red" />
          <StatCard title="Clics sur le lien"  value={fmt(igToday?.website_clicks)}     icon={MousePointerClick} color="green" />
          <StatCard title="Leads inbound (7 j)" value={data.inbound_leads}              icon={UserPlus}          color="green" />
        </div>
        <p className="mt-1.5 text-[11px] text-gray-400">
          Journée Instagram (heure du Pacifique : commence à 9 h à Paris). Abonnés : {fmt(igToday?.followers_total ?? igYesterday?.followers_total)}.
        </p>
      </div>

      {/* 7 derniers jours */}
      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
              <th className="px-4 py-2.5 font-medium">Jour</th>
              {shownFormats.map((f) => <th key={f} className="px-4 py-2.5 font-medium">{FORMAT_META[f].plural}</th>)}
              <th className="px-4 py-2.5 font-medium">Vues des contenus</th>
              <th className="px-4 py-2.5 font-medium">Leads inbound</th>
            </tr>
          </thead>
          <tbody>
            {history.map((h, i) => (
              <tr key={h.day} className="border-b border-gray-50 last:border-0">
                <td className="px-4 py-2 font-medium text-gray-700 capitalize">{fmtDay(h.day, i)}</td>
                {shownFormats.map((f) => {
                  const t = targets[f] ?? 0;
                  return (
                    <td key={f} className={`px-4 py-2 ${t > 0 && h[f] >= t ? 'text-green-600 font-semibold' : 'text-gray-700'}`}>
                      {h[f]}{t > 0 && <span className="text-gray-400 font-normal"> / {t}</span>}
                    </td>
                  );
                })}
                <td className="px-4 py-2 text-gray-700">{fmt(h.views)}</td>
                <td className="px-4 py-2 text-gray-700">{h.leads}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Inbound : commentaires à mot-clé et DM → leads */}
      <InboundPanel />

      {/* Contenus */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['all', ...FORMATS] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                filter === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f === 'all' ? 'Tous' : FORMAT_META[f].plural}
            </button>
          ))}
          <select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="select w-auto text-sm ml-auto">
            <option value="recent">Plus récents</option>
            <option value="views">Plus de vues</option>
            <option value="total_interactions">Plus d&apos;interactions</option>
            <option value="leads">Plus de leads</option>
          </select>
        </div>

        {items.length === 0 ? (
          <div className="card p-8 text-center text-gray-400 text-sm">Aucun contenu sur les 7 derniers jours.</div>
        ) : (
          <div className="card overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-medium">Contenu</th>
                  <th className="px-3 py-2.5 font-medium text-right">Vues</th>
                  <th className="px-3 py-2.5 font-medium text-right">Portée</th>
                  <th className="px-3 py-2.5 font-medium text-right">Likes</th>
                  <th className="px-3 py-2.5 font-medium text-right">Comm.</th>
                  <th className="px-3 py-2.5 font-medium text-right">Partages</th>
                  <th className="px-3 py-2.5 font-medium text-right">Enreg.</th>
                  <th className="px-3 py-2.5 font-medium text-right" title="Stories : réponses">Rép.</th>
                  <th className="px-3 py-2.5 font-medium text-right" title="Stories : visites du profil">Visites</th>
                  <th className="px-3 py-2.5 font-medium text-right">Leads</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {items.map((c) => <ContentRow key={c.id} c={c} />)}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function ContentRow({ c }: { c: IgContentItem }) {
  const meta = FORMAT_META[c.format];
  return (
    <tr className="border-b border-gray-50 last:border-0 hover:bg-gray-50/60">
      <td className="px-4 py-2">
        <div className="flex items-center gap-3 min-w-[260px]">
          {c.thumbnail_url
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={c.thumbnail_url} alt="" className="w-10 h-14 object-cover rounded-md bg-gray-100 flex-shrink-0" />
            : <div className="w-10 h-14 rounded-md bg-gray-100 flex-shrink-0" />}
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className={`badge ${meta.badge}`}>{meta.label}</span>
              <span className="text-xs text-gray-500 capitalize">{fmtTime(c.published_at)}</span>
            </div>
            <p className="text-xs text-gray-600 truncate max-w-[280px] mt-0.5">{c.caption?.split('\n')[0] || '—'}</p>
          </div>
        </div>
      </td>
      <td className="px-3 py-2 text-right font-semibold text-gray-900">{fmt(c.views)}</td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(c.reach)}</td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(c.likes)}</td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(c.comments)}</td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(c.shares)}</td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(c.saved)}</td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(c.replies)}</td>
      <td className="px-3 py-2 text-right text-gray-700">{fmt(c.profile_visits)}</td>
      <td className="px-3 py-2 text-right font-semibold text-green-700">{c.leads || '—'}</td>
      <td className="px-3 py-2">
        {c.permalink && (
          <a href={c.permalink} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-700" title="Ouvrir sur Instagram">
            <ExternalLink className="w-4 h-4" />
          </a>
        )}
      </td>
    </tr>
  );
}
