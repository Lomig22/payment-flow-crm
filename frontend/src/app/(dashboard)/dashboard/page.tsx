'use client';
import { useQuery } from '@tanstack/react-query';
import {
  Users, PhoneCall, CalendarCheck, TrendingUp,
  UserCheck, XCircle, Award, BarChart3
} from 'lucide-react';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';
import { dashboardApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import StatCard from '@/components/ui/StatCard';
import Spinner from '@/components/ui/Spinner';
import { formatDate } from '@/lib/utils';
import type { DashboardStats } from '@/types';

const QUALITY_COLORS = ['#ef4444', '#f97316', '#3b82f6', '#9ca3af'];
const QUALITY_NAMES  = ['Chaud', 'Tiède', 'Froid', 'Non qualifié'];

export default function DashboardPage() {
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn:  () => dashboardApi.getStats().then((r) => r.data as DashboardStats),
  });

  const { data: leaderboard } = useQuery({
    queryKey: ['leaderboard'],
    queryFn:  () => dashboardApi.getLeaderboard().then((r) => r.data),
    enabled:  isAdmin,
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Spinner className="w-8 h-8" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="card p-8 text-center text-gray-500">
        Impossible de charger les statistiques. Vérifiez la connexion au serveur.
      </div>
    );
  }

  const { overview, by_quality, by_status, by_setter, timeline } = data;

  const qualityChartData = [
    { name: 'Chaud',         value: Number(by_quality.hot) },
    { name: 'Tiède',         value: Number(by_quality.warm) },
    { name: 'Froid',         value: Number(by_quality.cold) },
    { name: 'Non qualifié',  value: Number(by_quality.unqualified) },
  ].filter((d) => d.value > 0);

  const statusChartData = [
    { name: 'En cours', value: Number(by_status.in_progress), fill: '#f59e0b' },
    { name: 'Client',   value: Number(by_status.client),      fill: '#10b981' },
    { name: 'Perdu',    value: Number(by_status.lost),        fill: '#6b7280' },
  ];

  const timelineFormatted = timeline.map((t) => ({
    ...t,
    date: formatDate(t.date),
  }));

  return (
    <div className="space-y-6">
      {/* Welcome banner */}
      <div className="card p-5 bg-gradient-to-r from-primary-600 to-indigo-600 text-white border-0">
        <h2 className="text-lg font-bold">
          Bonjour, {user?.first_name} 👋
        </h2>
        <p className="text-primary-100 text-sm mt-1">
          {isAdmin
            ? 'Vue globale de toutes les performances de votre équipe.'
            : 'Voici un résumé de vos leads et performances.'}
        </p>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          title="Total leads"
          value={overview.total_leads}
          icon={Users}
          color="purple"
        />
        <StatCard
          title="Leads appelés"
          value={overview.leads_called}
          icon={PhoneCall}
          color="blue"
        />
        <StatCard
          title="RDV pris"
          value={overview.appointments_taken}
          icon={CalendarCheck}
          color="orange"
        />
        <StatCard
          title="Clients signés"
          value={overview.clients_signed}
          icon={UserCheck}
          color="green"
        />
        <StatCard
          title="Taux de conversion"
          value={overview.conversion_rate}
          icon={TrendingUp}
          suffix="%"
          color="green"
        />
        <StatCard
          title="Taux de no-show"
          value={overview.no_show_rate}
          icon={XCircle}
          suffix="%"
          color="red"
        />
        <StatCard
          title="Devis envoyés"
          value={overview.quotes_sent}
          icon={BarChart3}
          color="blue"
        />
        <StatCard
          title="RDV honorés"
          value={overview.appointments_honored}
          icon={Award}
          color="purple"
        />
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Timeline area chart */}
        <div className="card p-5 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Activité — 30 derniers jours</h3>
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={timelineFormatted} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
              <defs>
                <linearGradient id="colorLeads" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#6366f1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorClients" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
              <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
              <Tooltip
                contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }}
              />
              <Area type="monotone" dataKey="leads_created" name="Leads créés"
                stroke="#6366f1" fill="url(#colorLeads)" strokeWidth={2} dot={false} />
              <Area type="monotone" dataKey="clients" name="Clients"
                stroke="#10b981" fill="url(#colorClients)" strokeWidth={2} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Quality pie chart */}
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Qualité des leads</h3>
          {qualityChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={qualityChartData}
                  cx="50%"
                  cy="45%"
                  innerRadius={55}
                  outerRadius={80}
                  paddingAngle={3}
                  dataKey="value"
                >
                  {qualityChartData.map((_, i) => (
                    <Cell key={i} fill={QUALITY_COLORS[i % QUALITY_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">
              Aucune donnée
            </div>
          )}
        </div>
      </div>

      {/* Setter performance (admin only) */}
      {isAdmin && by_setter && by_setter.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Performance par setter</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={by_setter.map((s) => ({
                name:       s.name.split(' ')[0],
                'Leads':    Number(s.total),
                'Clients':  Number(s.clients),
                'Appelés':  Number(s.called),
              }))}
              margin={{ top: 5, right: 10, bottom: 5, left: -20 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
              <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend iconSize={10} wrapperStyle={{ fontSize: 12 }} />
              <Bar dataKey="Leads"   fill="#e0e7ff" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Appelés" fill="#6366f1" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Clients" fill="#10b981" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Leaderboard (admin) */}
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
    </div>
  );
}
