'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import { Eye, Users, UserSearch, Heart, MousePointerClick, UserPlus, Inbox, ExternalLink } from 'lucide-react';
import api from '@/lib/api';
import StatCard from '@/components/ui/StatCard';
import Spinner from '@/components/ui/Spinner';

const DailyMetricChart = dynamic(() => import('@/components/dashboard/DashboardCharts').then((m) => m.DailyMetricChart), { ssr: false });

// Section « Contenu & profil » du dashboard Instagram : statistiques du compte choisi sur la période
// du sélecteur du dashboard, comparées à la période précédente de même durée.

interface Stats {
  account: string; accounts: string[]; since: string; until: string; prev_since: string;
  followers: number; inbound_leads: number;
  current: Record<string, number>; previous: Record<string, number>;
  daily: { day: string; views: number | null; profile_views: number | null; website_clicks: number | null }[];
  top: { id: string; caption: string | null; permalink: string | null; thumbnail_url: string | null; published_at: string; views: number | null; likes: number | null; comments: number | null; shares: number | null }[];
}

const fmt = (n: number | null | undefined) => (n ?? 0).toLocaleString('fr-FR');

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' });

export default function InstagramContentStats({ range }: { range: { from?: string; to?: string } }) {
  const [account, setAccount] = useState<string | undefined>();
  const { data, isLoading, error } = useQuery({
    queryKey: ['ig-account-stats', range.from, range.to, account],
    queryFn:  () => api.get<Stats>('/instagram/account-stats', { params: { ...range, range: range.from ? undefined : 'all', account } }).then((r) => r.data),
    staleTime: 10 * 60_000,
  });
  const meta = { prev: 'vs période préc.', label: 'la période' };

  // Évolution en % par rapport à la période précédente (masquée si pas de base)
  const trend = (key: string) => {
    const c = data?.current[key] ?? 0, p = data?.previous[key] ?? 0;
    if (!p) return undefined;
    const v = Math.round(((c - p) / p) * 100);
    return { value: Math.abs(v), isPositive: v >= 0, label: meta.prev };
  };

  const daily = (data?.daily ?? []).map((d) => ({
    date: new Date(`${d.day}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }),
    views: d.views, profile_views: d.profile_views,
  }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Contenu &amp; profil</p>
        {(data?.accounts ?? []).map((a) => (
          <button key={a} onClick={() => setAccount(a)}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${(account ?? data?.account) === a ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>@{a}</button>
        ))}
        {data && <span className="text-xs text-gray-500">{fmt(data.followers)} abonnés · du {shortDate(data.since)} au {shortDate(data.until)}</span>}
      </div>

      {isLoading ? (
        <div className="card p-8 flex justify-center"><Spinner className="w-6 h-6" /></div>
      ) : error || !data ? (
        <div className="card p-6 text-center text-sm text-gray-500">Statistiques Instagram indisponibles pour le moment.</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Vues"                          value={fmt(data.current.views)}              icon={Eye}               color="purple" trend={trend('views')} />
            <StatCard title="Comptes touchés"               value={fmt(data.current.reach)}              icon={Users}             color="blue"   trend={trend('reach')} />
            <StatCard title="Visites du profil"             value={fmt(data.current.profile_views)}      icon={UserSearch}        color="orange" trend={trend('profile_views')} />
            <StatCard title="Clics sur le lien en bio"      value={fmt(data.current.website_clicks)}     icon={MousePointerClick} color="green"  trend={trend('website_clicks')} />
            <StatCard title="Comptes ayant interagi"        value={fmt(data.current.accounts_engaged)}   icon={Heart}             color="red"    trend={trend('accounts_engaged')} />
            <StatCard title="Interactions"                  value={fmt(data.current.total_interactions)} icon={Heart}             color="red"    trend={trend('total_interactions')} />
            <StatCard title="Nouveaux abonnés"              value={`+${fmt(data.current.follows)}`}      icon={UserPlus}          color="green"  trend={trend('follows')} />
            <StatCard title="Leads inbound"                 value={fmt(data.inbound_leads)}              icon={Inbox}             color="gray" />
          </div>
          <p className="text-[11px] text-gray-400 -mt-2">
            Interactions : {fmt(data.current.likes)} j&apos;aime · {fmt(data.current.comments)} commentaires · {fmt(data.current.shares)} partages · {fmt(data.current.saves)} enregistrements
            {data.current.unfollows ? ` · ${fmt(data.current.unfollows)} désabonnements` : ''}
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Vues par jour</h3>
              <DailyMetricChart data={daily} dataKey="views" name="Vues" color="#6366f1" />
            </div>
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Visites du profil par jour</h3>
              <DailyMetricChart data={daily} dataKey="profile_views" name="Visites du profil" color="#f97316" />
            </div>
            <div className="card p-4">
              <h3 className="text-sm font-semibold text-gray-900 mb-2">Meilleurs contenus de la période</h3>
              {data.top.length === 0 ? (
                <p className="text-sm text-gray-400 py-6 text-center">Aucun contenu publié sur la période.</p>
              ) : (
                <div className="space-y-2">
                  {data.top.map((c) => (
                    <a key={c.id} href={c.permalink ?? '#'} target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-3 rounded-lg p-1.5 hover:bg-gray-50">
                      {c.thumbnail_url
                        // eslint-disable-next-line @next/next/no-img-element
                        ? <img src={c.thumbnail_url} alt="" className="w-8 h-11 object-cover rounded bg-gray-100 flex-shrink-0" />
                        : <div className="w-8 h-11 rounded bg-gray-100 flex-shrink-0" />}
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-gray-800 truncate">{(c.caption ?? '').split('\n')[0] || 'Sans légende'}</p>
                        <p className="text-[11px] text-gray-500">{fmt(c.views)} vues · {fmt(c.likes)} j&apos;aime · {fmt(c.comments)} comm.</p>
                      </div>
                      <ExternalLink className="w-3.5 h-3.5 text-gray-300 flex-shrink-0" />
                    </a>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
