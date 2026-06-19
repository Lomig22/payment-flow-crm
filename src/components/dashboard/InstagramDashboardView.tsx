'use client';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import {
  Users, Send, MessageCircle, Eye, FileText, CalendarCheck, TrendingUp, Clock,
} from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import StatCard from '@/components/ui/StatCard';
import Spinner from '@/components/ui/Spinner';
import { formatDate } from '@/lib/utils';
import type { InstagramDashboardStats } from '@/types';

const InstagramTimelineChart  = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.InstagramTimelineChart),  { ssr: false });
const InstagramSetterBarChart = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.InstagramSetterBarChart), { ssr: false });
const StatusFunnelChart       = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.StatusFunnelChart),        { ssr: false });
const NicheBarChart           = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.NicheBarChart),            { ssr: false });

const FUNNEL_LABELS: Record<string, string> = {
  lead:            'Lead',
  m1:              'M1 envoyé',
  r1:              'R1',
  r2:              'R2',
  reponse:         'Réponse',
  a_relancer:      'À relancer',
  audit_a_envoyer: 'Audit à envoyer',
  audit_envoye:    'Audit envoyé',
  rdv:             'RDV',
};
const FUNNEL_ORDER = ['lead', 'm1', 'r1', 'r2', 'reponse', 'a_relancer', 'audit_a_envoyer', 'audit_envoye', 'rdv'];

export default function InstagramDashboardView() {
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

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

  const { overview, by_status, by_niche, by_setter, timeline } = data;

  const funnelData = FUNNEL_ORDER
    .map((key) => ({ name: FUNNEL_LABELS[key], value: Number(by_status?.[key] ?? 0) }))
    .filter((d) => d.value > 0);

  const nicheData = (by_niche ?? []).map((n) => ({ name: n.niche, value: Number(n.count) }));

  const timelineFormatted = (timeline ?? []).map((t) => ({
    ...t,
    date: formatDate(t.date),
  }));

  const setterChartData = (by_setter ?? []).map((s) => ({
    name:              s.name.split(' ')[0],
    'M1':              Number(s.m1),
    'R1':              Number(s.r1),
    'R2':              Number(s.r2),
    'Réponses':        Number(s.reponse),
    'Audit à env.':    Number(s.audit_a_envoyer),
    'Audit envoyé':    Number(s.audit_envoye),
    'RDV':             Number(s.rdv),
  }));

  return (
    <div className="space-y-6">
      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total leads IG"      value={overview.total_leads}        icon={Users}         color="purple" />
        <StatCard title="M1 envoyés"          value={overview.m1_sent}            icon={Send}          color="blue"   />
        <StatCard title="Taux d'ouverture"    value={overview.open_rate}          icon={Eye}           suffix="%" color="orange" />
        <StatCard title="Réponses"            value={overview.reponse}            icon={MessageCircle} color="green"  />
        <StatCard title="Audits envoyés"      value={overview.audit_envoye}       icon={FileText}      color="purple" />
        <StatCard title="RDV pris"            value={overview.rdv}                icon={CalendarCheck} color="red"    />
        <StatCard title="Taux de conv. RDV"   value={overview.rdv_conversion_rate} icon={TrendingUp}    suffix="%" color="green" />
        <StatCard title="À relancer"          value={overview.a_relancer}         icon={Clock}         color="gray"   />
      </div>

      {/* Timeline + Funnel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Activité du funnel — 30 derniers jours</h3>
          <InstagramTimelineChart data={timelineFormatted} />
        </div>
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Funnel par statut</h3>
          {funnelData.length > 0
            ? <StatusFunnelChart data={funnelData} />
            : <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>}
        </div>
      </div>

      {/* Setter activity + Niche */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {isAdmin && by_setter && by_setter.length > 0 && (
          <div className="card p-5 lg:col-span-2">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Activité par setter</h3>
            <InstagramSetterBarChart data={setterChartData} />
          </div>
        )}
        <div className={`card p-5 ${isAdmin && by_setter && by_setter.length > 0 ? '' : 'lg:col-span-3'}`}>
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Répartition par niche</h3>
          <NicheBarChart data={nicheData} />
        </div>
      </div>
    </div>
  );
}
