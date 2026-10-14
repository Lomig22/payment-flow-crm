'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send, Reply, AlertTriangle, Sparkles, Bot, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import { emailingApi, type EmailSettingsCfg } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';
import StatCard from '@/components/ui/StatCard';

// Pilotage de l'emailing : les mails partent de Hermès (ses boîtes préchauffées), le CRM décide
// qui contacter et quand, et reçoit chaque événement (envoi, réponse, rebond, désinscription).

const STATUS: Record<string, string> = {
  new: 'À contacter', in_sequence: 'En séquence', replied: 'Ont répondu', interested: 'Intéressés', not_interested: 'Pas intéressés',
  bounced: 'Adresse invalide', unsubscribed: 'Désinscrits', dnc: 'Ne pas contacter', completed: 'Séquence terminée',
};
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : '—');

export default function EmailingPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['emailing-stats'], queryFn: () => emailingApi.stats().then((r) => r.data), refetchInterval: 60_000 });
  const [cfg, setCfg] = useState<EmailSettingsCfg | null>(null);
  useEffect(() => { if (data && !cfg) setCfg(data.settings); }, [data, cfg]);
  const save = useMutation({
    mutationFn: (s: Partial<EmailSettingsCfg>) => emailingApi.settings(s).then((r) => r.data),
    onSuccess: (s) => { setCfg(s); toast.success('Enregistré'); qc.invalidateQueries({ queryKey: ['emailing-stats'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  if (isLoading || !data || !cfg) return <div className="flex justify-center py-20"><Spinner /></div>;
  const goalPct = Math.min(100, Math.round((data.today.sent / Math.max(1, cfg.daily_goal)) * 100));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Mail className="w-6 h-6 text-indigo-500" />Emailing · Pilotage</h1>
          <p className="text-sm text-gray-500 mt-1">Les mails partent de Hermès ; le CRM choisit qui contacter, arrête la séquence à la première réponse et tient les compteurs.</p>
        </div>
        <button onClick={() => save.mutate({ active: !cfg.active })}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${cfg.active ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
          <Power className="w-4 h-4" />{cfg.active ? 'Envois actifs' : 'Envois en pause'}
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-baseline justify-between"><p className="font-semibold text-gray-900">Aujourd&apos;hui</p><p className="text-sm text-gray-500">{data.today.sent.toLocaleString('fr-FR')} / {cfg.daily_goal.toLocaleString('fr-FR')} mails</p></div>
        <div className="h-3 rounded-full bg-gray-100 mt-2 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${goalPct}%` }} /></div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Envoyés (7 j)" value={data.week.sent.toLocaleString('fr-FR')} icon={Send} />
        <StatCard title="Réponses (7 j)" value={`${data.week.replied} · ${pct(data.week.replied, data.week.sent)}`} icon={Reply} />
        <StatCard title="Intéressés (7 j)" value={String(data.week.interested)} icon={Sparkles} />
        <StatCard title="Rebonds (7 j)" value={`${data.week.bounced} · ${pct(data.week.bounced, data.week.sent)}`} icon={AlertTriangle} />
      </div>

      <div className="card p-5">
        <p className="font-semibold text-gray-900 mb-3">Leads par statut</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(STATUS).map(([k, label]) => (
            <a key={k} href={`/emailing/leads?status=${k}`} className="rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
              <p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900">{(data.by_status[k] ?? 0).toLocaleString('fr-FR')}</p>
            </a>
          ))}
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <p className="font-semibold text-gray-900">Réglages</p>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="text-sm">Objectif par jour<input type="number" className="input mt-1" value={cfg.daily_goal} onChange={(e) => setCfg({ ...cfg, daily_goal: Number(e.target.value) })} /></label>
          <label className="text-sm">Envois à partir de (h)<input type="number" className="input mt-1" value={cfg.send_from} onChange={(e) => setCfg({ ...cfg, send_from: Number(e.target.value) })} /></label>
          <label className="text-sm">Jusqu&apos;à (h)<input type="number" className="input mt-1" value={cfg.send_to} onChange={(e) => setCfg({ ...cfg, send_to: Number(e.target.value) })} /></label>
        </div>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map((d, i) => {
            const on = cfg.send_days.includes(i + 1);
            return <button key={d} onClick={() => setCfg({ ...cfg, send_days: on ? cfg.send_days.filter((x) => x !== i + 1) : [...cfg.send_days, i + 1].sort() })}
              className={`px-3 py-1 rounded-full text-sm ${on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{d}</button>;
          })}
        </div>
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">Séquence (modèles facultatifs : vides, Hermès rédige selon les consignes ; variables {'{{first_name}}'}, {'{{company}}'}, {'{{city}}'}…)</p>
          {cfg.steps.map((s, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-3 space-y-2">
              <div className="flex items-center gap-3 text-sm"><b>Mail {s.step}</b>
                {i > 0 && <span className="text-gray-500 inline-flex items-center gap-1">envoyé <input type="number" className="input w-16 py-1" value={s.delay_days} onChange={(e) => setCfg({ ...cfg, steps: cfg.steps.map((x, j) => (j === i ? { ...x, delay_days: Number(e.target.value) } : x)) })} /> jours après le précédent</span>}
              </div>
              <input className="input text-sm" placeholder="Objet" value={s.subject} onChange={(e) => setCfg({ ...cfg, steps: cfg.steps.map((x, j) => (j === i ? { ...x, subject: e.target.value } : x)) })} />
              <textarea className="input text-sm" rows={3} placeholder="Corps du mail" value={s.body} onChange={(e) => setCfg({ ...cfg, steps: cfg.steps.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)) })} />
            </div>
          ))}
        </div>
        <label className="text-sm block">Consignes de rédaction pour Hermès
          <textarea className="input mt-1 text-sm" rows={4} value={cfg.instructions} placeholder="Ton, longueur, offre, ce qu'il ne faut jamais écrire…" onChange={(e) => setCfg({ ...cfg, instructions: e.target.value })} />
        </label>
        <button className="btn-primary text-sm" disabled={save.isPending} onClick={() => save.mutate(cfg)}>Enregistrer</button>
      </div>

      <div className="card p-5 text-sm space-y-2">
        <p className="font-semibold text-gray-900 flex items-center gap-2"><Bot className="w-4 h-4" />Connexion de Hermès</p>
        <p className={data.agent_configured ? 'text-emerald-700' : 'text-amber-700'}>{data.agent_configured ? 'Clé de l\'agent configurée.' : 'Clé de l\'agent pas encore configurée (EMAILING_AGENT_KEY).'}</p>
        <p className="text-gray-600">Dernier événement reçu : {data.last_event_at ? new Date(data.last_event_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : 'aucun'}</p>
      </div>
    </div>
  );
}
