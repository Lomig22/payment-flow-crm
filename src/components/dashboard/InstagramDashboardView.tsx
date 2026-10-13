'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import {
  Send, MessageCircle, Eye, CalendarCheck, TrendingUp, Clock,
  UserPlus, UserCheck, Inbox, Snowflake, Reply,
} from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import StatCard from '@/components/ui/StatCard';
import Spinner from '@/components/ui/Spinner';
import { formatDate } from '@/lib/utils';
import InstagramFunnel from '@/components/dashboard/InstagramFunnel';
import InstagramContentStats from '@/components/dashboard/InstagramContentStats';
import type { InstagramDashboardStats } from '@/types';

const InstagramTimelineChart  = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.InstagramTimelineChart),  { ssr: false });
const InstagramSetterBarChart = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.InstagramSetterBarChart), { ssr: false });
const StatusFunnelChart       = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.StatusFunnelChart),        { ssr: false });
const NicheBarChart           = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.NicheBarChart),            { ssr: false });

const FUNNEL_STEPS = [
  { key: 'lead',            label: 'Lead',            source: 'status'   as const },
  { key: 'm1',               label: 'M1 envoyé',       source: 'status'   as const },
  { key: 'open_count',       label: 'Ouverture',       source: 'overview' as const },
  { key: 'r1',               label: 'R1',              source: 'status'   as const },
  { key: 'r2',               label: 'R2',              source: 'status'   as const },
  { key: 'reponse',          label: 'Réponse',         source: 'status'   as const },
  { key: 'a_relancer',       label: 'À relancer',      source: 'status'   as const },
  { key: 'audit_a_envoyer',  label: 'Audit à envoyer', source: 'status'   as const },
  { key: 'audit_envoye',     label: 'Audit envoyé',    source: 'status'   as const },
  { key: 'rdv',              label: 'RDV',             source: 'status'   as const },
];

// Colonnes du détail d'activité par setter (heure de Paris pour follows, DM, follow backs, actions)
const SETTER_COLUMNS = [
  { key: 'follows',      label: 'Follows',       hint: 'Follows envoyés depuis le CRM' },
  { key: 'follow_backs', label: 'Follow backs',  hint: 'Prospects qui ont suivi en retour' },
  { key: 'dms',          label: 'DM envoyés',    hint: 'Tous les DM de prospection envoyés (M1, R1, R2)' },
  { key: 'm1',           label: 'M1' },
  { key: 'r1',           label: 'R1' },
  { key: 'r2',           label: 'R2' },
  { key: 'reponse',      label: 'Réponses' },
  { key: 'audit_envoye', label: 'Audits' },
  { key: 'rdv',          label: 'RDV' },
  { key: 'actions',      label: 'Actions totales', hint: 'Toutes les modifications faites sur les leads (statuts, notes…)' },
];

export default function InstagramDashboardView() {
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [dayIndex, setDayIndex] = useState(0);

  const { data, isLoading, error } = useQuery({
    queryKey: ['instagram-dashboard-stats'],
    queryFn:  () => dashboardApi.getInstagramStats().then((r) => r.data as InstagramDashboardStats),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (error || !data || !data.overview) {
    return (
      <div className="card p-8 text-center text-gray-500">
        Impossible de charger les statistiques Instagram. Vérifiez la connexion au serveur.
      </div>
    );
  }

  const { overview, by_status, by_niche, by_setter_daily, timeline, funnel } = data;

  // Stock (statut actuel) et taux globaux, toutes pistes confondues
  const stock   = funnel?.stock ?? {};
  const dmSent  = (funnel?.funnel_follow.dm_sent ?? 0) + (funnel?.funnel_dm.dm_sent ?? 0);
  const replied = (funnel?.funnel_follow.replied ?? 0) + (funnel?.funnel_dm.replied ?? 0);
  const replyRate = dmSent > 0 ? Math.round((replied / dmSent) * 1000) / 10 : 0;
  const fbSent  = funnel?.funnel_follow.followed ?? 0;
  const fbBack  = funnel?.funnel_follow.followed_back ?? 0;
  const followBackRate = fbSent > 0 ? Math.round((fbBack / fbSent) * 1000) / 10 : 0;

  const funnelData = FUNNEL_STEPS
    .map(({ key, label, source }) => ({
      name:  label,
      value: Number(source === 'overview' ? overview.open_count : by_status?.[key] ?? 0),
    }))
    .filter((d) => d.value > 0);

  const nicheData = (by_niche ?? []).map((n) => ({ name: n.niche, value: Number(n.count) }));

  // Follows / follow backs / DM par piste, fusionnés par jour dans l'activité 30 jours
  const extraByDate = new Map((funnel?.timeline ?? []).map((t) => [t.date, t]));
  const timelineFormatted = (timeline ?? []).map((t) => {
    const x = extraByDate.get(t.date);
    return {
      ...t,
      follows:      Number(x?.follows ?? 0),
      follow_backs: Number(x?.follow_backs ?? 0),
      date: formatDate(t.date),
    };
  });

  const dayOptions = (by_setter_daily ?? []).map((d) => d.date);
  const selectedDay = by_setter_daily?.[dayIndex];

  const setterChartData = (selectedDay?.setters ?? []).map((s) => ({
    name:              s.name.split(' ')[0],
    'M1':              Number(s.m1),
    'R1':              Number(s.r1),
    'R2':              Number(s.r2),
    'Réponses':        Number(s.reponse),
    'Audit envoyé':    Number(s.audit_envoye),
    'RDV':             Number(s.rdv),
  }));

  return (
    <div className="space-y-6">
      {/* Contenu & profil : vues, visites, clics sur le lien en bio… (admins) */}
      {isAdmin && <InstagramContentStats />}

      {/* KPI — piste follow */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Piste follow d’abord</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="À follow"                 value={stock.to_follow ?? 0}      icon={UserPlus}  color="blue"   />
          <StatCard title="Follows envoyés"          value={fbSent}                    icon={Send}      color="blue"   />
          <StatCard title="Follow backs"             value={fbBack}                    icon={UserCheck} color="green"  />
          <StatCard title="Taux de follow back"      value={followBackRate}            icon={TrendingUp} suffix="%" color="green" />
        </div>
      </div>

      {/* KPI — DM */}
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Messages</p>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="DM à envoyer (follow backs)" value={stock.followed_back ?? 0} icon={Inbox}     color="orange" />
          <StatCard title="DM à froid à envoyer"     value={stock.lead ?? 0}           icon={Snowflake} color="gray"   />
          <StatCard title="DM envoyés (M1)"          value={dmSent}                    icon={Send}      color="blue"   />
          <StatCard title="Taux d'ouverture"         value={overview.open_rate}        icon={Eye}       suffix="%" color="orange" />
          <StatCard title="Réponses"                 value={replied}                   icon={MessageCircle} color="green" />
          <StatCard title="Taux de réponse"          value={replyRate}                 icon={Reply}     suffix="%" color="green" />
          <StatCard title="RDV pris"                 value={overview.rdv}              icon={CalendarCheck} color="red" />
          <StatCard title="À relancer"               value={overview.a_relancer}       icon={Clock}     color="gray"   />
        </div>
      </div>

      {/* Vision funnel + goulots d'étranglement */}
      {funnel && <InstagramFunnel funnel={funnel} />}

      {/* Timeline + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Activité du funnel — 30 derniers jours</h3>
          <InstagramTimelineChart data={timelineFormatted} />
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par statut (aujourd’hui)</h3>
          {funnelData.length > 0
            ? <StatusFunnelChart data={funnelData} />
            : <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>}
        </div>
      </div>

      {/* Setter activity + Niche */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {isAdmin && dayOptions.length > 0 && (
          <div className="card p-5 lg:col-span-2">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-900">Activité par setter</h3>
              <div className="flex gap-1.5">
                {dayOptions.map((date, i) => (
                  <button
                    key={date}
                    onClick={() => setDayIndex(i)}
                    className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                      dayIndex === i ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                    }`}
                  >
                    {i === 0 ? "Aujourd'hui" : `J-${i}`}
                  </button>
                ))}
              </div>
            </div>
            {setterChartData.length > 0
              ? <InstagramSetterBarChart data={setterChartData} />
              : <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Aucune activité ce jour-là</div>}

            {/* Toute l'activité du jour, par setter (follows et DM inclus) */}
            {(selectedDay?.setters ?? []).length > 0 && (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                      <th className="py-2 pr-3 font-medium">Setter</th>
                      {SETTER_COLUMNS.map((c) => <th key={c.key} className="py-2 px-2 font-medium text-right" title={c.hint}>{c.label}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {selectedDay!.setters.map((st) => (
                      <tr key={st.setter_id ?? st.name} className="border-b border-gray-50 last:border-0">
                        <td className="py-2 pr-3 font-medium text-gray-800 whitespace-nowrap">{st.name}</td>
                        {SETTER_COLUMNS.map((c) => {
                          const v = Number((st as any)[c.key] ?? 0);
                          return <td key={c.key} className={`py-2 px-2 text-right tabular-nums ${v ? 'text-gray-900' : 'text-gray-300'}`}>{v}</td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        <div className={`card p-5 ${isAdmin && dayOptions.length > 0 ? '' : 'lg:col-span-3'}`}>
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par niche</h3>
          <NicheBarChart data={nicheData} />
        </div>
      </div>
    </div>
  );
}
