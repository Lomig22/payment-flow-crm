'use client';
import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useQuery } from '@tanstack/react-query';
import {
  Users, PhoneCall, CalendarCheck, TrendingUp,
  UserCheck, XCircle, Award, BarChart3, Instagram,
} from 'lucide-react';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import StatCard from '@/components/ui/StatCard';
import Spinner from '@/components/ui/Spinner';
import InstagramDashboardView from '@/components/dashboard/InstagramDashboardView';
import { formatDate } from '@/lib/utils';
import type { DashboardStats } from '@/types';

// Recharts accède à ResizeObserver (browser-only) — chargement côté client uniquement
const TimelineChart  = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.TimelineChart),  { ssr: false });
const QualityChart   = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.QualityChart),   { ssr: false });
const SetterBarChart = dynamic(() => import('@/components/dashboard/DashboardCharts').then(m => m.SetterBarChart), { ssr: false });

export default function DashboardPage() {
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';
  const [view, setView] = useState<'cold_call' | 'instagram'>('cold_call');

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn:  () => dashboardApi.getStats().then((r) => r.data as DashboardStats),
    enabled:  view === 'cold_call',
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['leaderboard'],
    queryFn:  () => dashboardApi.getLeaderboard().then((r) => r.data),
    enabled:  isAdmin && view === 'cold_call',
  });

  const qualityChartData = data?.by_quality ? [
    { name: 'Chaud',        value: Number(data.by_quality.hot        ?? 0) },
    { name: 'Tiède',        value: Number(data.by_quality.warm       ?? 0) },
    { name: 'Froid',        value: Number(data.by_quality.cold       ?? 0) },
    { name: 'Non qualifié', value: Number(data.by_quality.unqualified ?? 0) },
  ].filter((d) => d.value > 0) : [];

  const timelineFormatted = (data?.timeline ?? []).map((t) => ({
    ...t,
    date: formatDate(t.date),
  }));

  const setterChartData = (data?.by_setter ?? []).map((s) => ({
    name:      s.name.split(' ')[0],
    'Leads':   Number(s.total),
    'Clients': Number(s.clients),
    'Appelés': Number(s.called),
  }));

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="card p-5 bg-gradient-to-r from-primary-600 to-indigo-600 text-white border-0">
        <h2 className="text-lg font-bold">Bonjour, {user?.first_name} 👋</h2>
        <p className="text-primary-100 text-sm mt-1">
          {isAdmin
            ? 'Vue globale de toutes les performances de votre équipe.'
            : 'Voici un résumé de vos leads et performances.'}
        </p>
      </div>

      {/* View switcher */}
      <div className="flex gap-2">
        <button
          onClick={() => setView('cold_call')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            view === 'cold_call' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <PhoneCall className="w-4 h-4" /> Cold Call
        </button>
        <button
          onClick={() => setView('instagram')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            view === 'instagram' ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          <Instagram className="w-4 h-4" /> Instagram
        </button>
      </div>

      {view === 'instagram' ? (
        <InstagramDashboardView />
      ) : isLoading ? (
        <div className="flex items-center justify-center h-64">
          <Spinner className="w-8 h-8" />
        </div>
      ) : error || !data || !data.overview ? (
        <div className="card p-8 text-center text-gray-500">
          Impossible de charger les statistiques. Vérifiez la connexion au serveur.
        </div>
      ) : (
        <>
          {/* KPI Grid */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard title="Total leads"       value={data.overview.total_leads}          icon={Users}      color="purple" />
            <StatCard title="Leads appelés"     value={data.overview.leads_called}         icon={PhoneCall}  color="blue"   />
            <StatCard title="RDV pris"          value={data.overview.appointments_taken}   icon={CalendarCheck} color="orange" />
            <StatCard title="Clients signés"    value={data.overview.clients_signed}       icon={UserCheck}  color="green"  />
            <StatCard title="Taux de conversion" value={data.overview.conversion_rate}     icon={TrendingUp} suffix="%" color="green" />
            <StatCard title="Taux de no-show"   value={data.overview.no_show_rate}         icon={XCircle}    suffix="%" color="red"   />
            <StatCard title="Devis envoyés"     value={data.overview.quotes_sent}          icon={BarChart3}  color="blue"   />
            <StatCard title="RDV honorés"       value={data.overview.appointments_honored} icon={Award}      color="purple" />
          </div>

          {/* Charts */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="card p-5 lg:col-span-2">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Activité — 30 derniers jours</h3>
              <TimelineChart data={timelineFormatted} />
            </div>
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Qualité des leads</h3>
              <QualityChart data={qualityChartData} />
            </div>
          </div>

          {isAdmin && data.by_setter && data.by_setter.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">Performance par setter</h3>
              <SetterBarChart data={setterChartData} />
            </div>
          )}

          {/* Leaderboard */}
          {isAdmin && leaderboard && leaderboard.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-4">🏆 Classement des setters</h3>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-100">
                      <th className="th w-8">#</th>
                      <th className="th">Setter</th>
                      <th className="th text-right">Total</th>
                      <th className="th text-right">Appelés</th>
                      <th className="th text-right">RDV</th>
                      <th className="th text-right">Clients</th>
                      <th className="th text-right">Conversion</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((s: any, i: number) => (
                      <tr key={s.id} className="table-row">
                        <td className="td font-bold text-gray-400">{i + 1}</td>
                        <td className="td font-medium">{s.first_name} {s.last_name}</td>
                        <td className="td text-right">{s.total_leads}</td>
                        <td className="td text-right">{s.called}</td>
                        <td className="td text-right">{s.appointments}</td>
                        <td className="td text-right text-green-600 font-medium">{s.clients}</td>
                        <td className="td text-right">
                          <span className={`font-semibold ${Number(s.conversion_rate) >= 20 ? 'text-green-600' : 'text-gray-600'}`}>
                            {s.conversion_rate}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
