'use client';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface TimelineItem { date: string; leads_created: number; clients: number; appointments: number; }
interface SetterItem   { name: string; Leads: number; Appelés: number; Clients: number; }
interface QualityItem  { name: string; value: number; }
interface StatusItem   { name: string; value: number; fill: string; }

const QUALITY_COLORS = ['#ef4444', '#f97316', '#3b82f6', '#9ca3af'];

export function TimelineChart({ data }: { data: TimelineItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
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
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
        <Area type="monotone" dataKey="leads_created" name="Leads créés"
          stroke="#6366f1" fill="url(#colorLeads)" strokeWidth={2} dot={false} />
        <Area type="monotone" dataKey="clients" name="Clients"
          stroke="#10b981" fill="url(#colorClients)" strokeWidth={2} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function QualityChart({ data }: { data: QualityItem[] }) {
  if (!data.length) return (
    <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>
  );
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} cx="50%" cy="45%" innerRadius={55} outerRadius={80} paddingAngle={3} dataKey="value">
          {data.map((_, i) => <Cell key={i} fill={QUALITY_COLORS[i % QUALITY_COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function SetterBarChart({ data }: { data: SetterItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
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
  );
}
