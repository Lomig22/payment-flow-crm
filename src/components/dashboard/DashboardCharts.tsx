'use client';
import {
  AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend,
} from 'recharts';

interface TimelineItem { date: string; leads_created: number; clients: number; appointments: number; }
interface SetterItem   { name: string; Leads: number; Appelés: number; Relances: number; 'Relances 2': number; RDV: number; Perdus: number; Clients: number; }
interface SetterDailyItem { name: string; 'Leads': number; 'Appelés': number; 'Relances': number; 'Relances 2': number; 'RDV': number; 'Devis': number; 'Perdus': number; 'Clients': number; }
interface QualityItem  { name: string; value: number; }
interface StatusItem   { name: string; value: number; fill: string; }
interface IgTimelineItem { date: string; m1: number; r1: number; r2: number; reponse: number; audit_envoye: number; rdv: number; }
interface IgSetterItem   { name: string; M1: number; R1: number; R2: number; 'Réponses': number; 'Audit envoyé': number; RDV: number; }
interface FunnelItem     { name: string; value: number; }
interface NicheItem      { name: string; value: number; }

const QUALITY_COLORS = ['#ef4444', '#f97316', '#3b82f6', '#9ca3af'];
const FUNNEL_COLOR = '#6366f1';
const NICHE_COLOR  = '#3b82f6';

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
        <Bar dataKey="Leads"      fill="#e0e7ff" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Appelés"    fill="#6366f1" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Relances"   fill="#f59e0b" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Relances 2" fill="#a855f7" radius={[4, 4, 0, 0]} />
        <Bar dataKey="RDV"        fill="#f97316" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Perdus"     fill="#ef4444" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Clients"    fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function ColdCallSetterDailyBarChart({ data }: { data: SetterDailyItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Leads"      fill="#e0e7ff" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Appelés"    fill="#6366f1" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Relances"   fill="#f59e0b" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Relances 2" fill="#a855f7" radius={[4, 4, 0, 0]} />
        <Bar dataKey="RDV"        fill="#f97316" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Devis"      fill="#06b6d4" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Perdus"     fill="#ef4444" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Clients"    fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function InstagramTimelineChart({ data }: { data: IgTimelineItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, border: '1px solid #e5e7eb' }} />
        <Legend iconSize={8} wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="m1"           name="M1"            stroke="#3b82f6" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="r1"           name="R1"            stroke="#f97316" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="r2"           name="R2"            stroke="#10b981" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="reponse"      name="Réponses"      stroke="#06b6d4" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="audit_envoye" name="Audit envoyé"  stroke="#a855f7" strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="rdv"          name="RDV"           stroke="#ef4444" strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function InstagramSetterBarChart({ data }: { data: IgSetterItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={280}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="name" tick={{ fontSize: 12 }} tickLine={false} />
        <YAxis tick={{ fontSize: 12 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="M1"            fill="#3b82f6" radius={[4, 4, 0, 0]} />
        <Bar dataKey="R1"            fill="#f97316" radius={[4, 4, 0, 0]} />
        <Bar dataKey="R2"            fill="#10b981" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Réponses"      fill="#06b6d4" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Audit envoyé" fill="#a855f7" radius={[4, 4, 0, 0]} />
        <Bar dataKey="RDV"          fill="#ef4444" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

interface UserMonthlyItem { month: string; Leads: number; RDV: number; Clients: number; }

export function UserMonthlyChart({ data }: { data: UserMonthlyItem[] }) {
  if (!data.length) return (
    <div className="h-[200px] flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>
  );
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 5, right: 10, bottom: 5, left: -20 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} tickLine={false} />
        <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} allowDecimals={false} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Legend iconSize={10} wrapperStyle={{ fontSize: 11 }} />
        <Bar dataKey="Leads"   fill="#e0e7ff" radius={[4, 4, 0, 0]} />
        <Bar dataKey="RDV"     fill="#f97316" radius={[4, 4, 0, 0]} />
        <Bar dataKey="Clients" fill="#10b981" radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatusFunnelChart({ data }: { data: FunnelItem[] }) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} tickLine={false} width={110} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="value" fill={FUNNEL_COLOR} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function NicheBarChart({ data }: { data: NicheItem[] }) {
  if (!data.length) return (
    <div className="h-[220px] flex items-center justify-center text-gray-400 text-sm">Aucune donnée</div>
  );
  return (
    <ResponsiveContainer width="100%" height={Math.max(220, data.length * 32)}>
      <BarChart data={data} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis type="number" tick={{ fontSize: 12 }} tickLine={false} axisLine={false} />
        <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} tickLine={false} width={110} />
        <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
        <Bar dataKey="value" fill={NICHE_COLOR} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
