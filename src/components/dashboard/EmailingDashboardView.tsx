'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Users, MailCheck, Eye, Reply, ThumbsUp, ThumbsDown, AlertTriangle, ShieldAlert, Plus, Minus, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { campaignsApi, type EmailReplyRow } from '@/lib/api';
import StatCard from '@/components/ui/StatCard';
import Spinner from '@/components/ui/Spinner';

// Dashboard > Emailing : vue globale de tous les envois d'Hermès (lomig.guegueniat@gmail.com).
// Réponses et rebonds lus dans la boîte Gmail toutes les 15 min ; réponses automatiques et anti-spam
// séparées des vraies réponses ; chaque vraie réponse se classe + ou −.

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10} %`);
const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
// Lien vers la réponse dans la boîte qui a reçu le mail (Hermès alterne deux boîtes Gmail)
const gmailLink = (r: EmailReplyRow) => {
  const base = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(r.mailbox || 'lomig.guegueniat@gmail.com')}`;
  return r.reply_gmail_id ? `${base}#all/${r.reply_gmail_id}` : `${base}#search/${encodeURIComponent(r.email)}`;
};

function Bar({ label, value, max, cls }: { label: string; value: number; max: number; cls: string }) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 text-gray-600 flex-shrink-0">{label}</span>
      <div className="flex-1 h-6 bg-gray-100 rounded-md overflow-hidden"><div className={`h-full rounded-md ${cls}`} style={{ width: `${max ? Math.max(value ? 1.5 : 0, (value / max) * 100) : 0}%` }} /></div>
      <span className="w-14 text-right font-semibold text-gray-900 tabular-nums">{value}</span>
    </div>
  );
}

function ReplyRow({ r }: { r: EmailReplyRow }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (s: 'positive' | 'negative' | null) => campaignsApi.classify(r.id, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emailing-dashboard'] }),
    onError: () => toast.error('Erreur'),
  });
  const toggle = (s: 'positive' | 'negative') => set.mutate(r.sentiment === s ? null : s);
  return (
    <div className="card p-3 flex items-start gap-3">
      <div className="flex flex-col gap-1">
        <button onClick={() => toggle('positive')} title="Positive" className={`w-9 h-9 rounded-lg flex items-center justify-center border ${r.sentiment === 'positive' ? 'bg-emerald-500 border-emerald-500 text-white' : 'border-gray-200 text-emerald-600 hover:bg-emerald-50'}`}><Plus className="w-4 h-4" /></button>
        <button onClick={() => toggle('negative')} title="Négative" className={`w-9 h-9 rounded-lg flex items-center justify-center border ${r.sentiment === 'negative' ? 'bg-red-500 border-red-500 text-white' : 'border-gray-200 text-red-600 hover:bg-red-50'}`}><Minus className="w-4 h-4" /></button>
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline gap-x-2 text-sm">
          <b className="text-gray-900">{r.company || r.email}</b>
          <span className="text-xs text-gray-400">{r.campaign}</span>
          <span className="text-xs text-gray-400 ml-auto">{when(r.replied_at)}</span>
        </div>
        <p className="text-sm text-gray-700 mt-1">{r.reply_snippet || '(réponse sans texte)'}</p>
        <a href={gmailLink(r)} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 inline-flex items-center gap-1">Ouvrir dans Gmail <ExternalLink className="w-3 h-3" /></a>
      </div>
    </div>
  );
}

export default function EmailingDashboardView() {
  const { data, isLoading } = useQuery({ queryKey: ['emailing-dashboard'], queryFn: () => campaignsApi.list().then((r) => r.data), refetchInterval: 60_000 });
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  const [showAuto, setShowAuto] = useState(false);
  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner className="w-8 h-8" /></div>;
  const t = data.totals;
  if (!t.contacted) return <div className="card p-8 text-center text-gray-500">Aucun envoi remonté pour l&apos;instant.</div>;
  const replies = data.replies.filter((r) => filter === 'all' || !r.sentiment);
  const maxDay = Math.max(1, ...data.by_day.map((d) => d.sent));
  return (
    <div className="space-y-6">
      <p className="text-sm text-gray-500">Tous les mails envoyés par Hermès (lomig.guegueniat@gmail.com et paymentfloww@gmail.com). Réponses et rebonds lus dans la boîte Gmail toutes les 15 min ; les réponses automatiques et les blocages anti-spam ne comptent pas comme des réponses.</p>

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard title="Personnes contactées" value={t.contacted} icon={Users} color="purple" />
        <StatCard title="Mails remis" value={t.delivered} icon={MailCheck} color="blue" />
        <StatCard title="Ouvertures" value={t.opened ?? 'non mesuré'} icon={Eye} color="gray" />
        <StatCard title="Taux d'ouverture" value={t.open_rate == null ? 'non mesuré' : pct(t.open_rate)} icon={Eye} color="gray" />
        <StatCard title="Réponses" value={t.replied} icon={Reply} color="green" />
        <StatCard title="Taux de réponse" value={pct(t.reply_rate)} icon={Reply} color="green" />
        <StatCard title="Positives" value={t.positive} icon={ThumbsUp} color="green" />
        <StatCard title="Négatives" value={t.negative} icon={ThumbsDown} color="red" />
        <StatCard title="Rebonds" value={t.bounced} icon={AlertTriangle} color="orange" />
        <StatCard title="Bloqués anti-spam" value={t.antispam} icon={ShieldAlert} color="orange" />
      </div>
      {t.open_rate == null && <p className="text-xs text-gray-500 -mt-3">Ouvertures non mesurées : les mails partent en texte brut, sans pixel de suivi.</p>}

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold text-gray-900">Entonnoir</h3>
          <Bar label="Contactés" value={t.contacted} max={t.contacted} cls="bg-indigo-400" />
          <Bar label="Remis" value={t.delivered} max={t.contacted} cls="bg-sky-400" />
          <Bar label="Réponses" value={t.replied} max={t.contacted} cls="bg-emerald-400" />
          <Bar label="Positives" value={t.positive} max={t.contacted} cls="bg-emerald-600" />
        </div>
        <div className="card p-5 space-y-3">
          <h3 className="font-semibold text-gray-900">Par jour</h3>
          {data.by_day.map((d) => (
            <div key={d.date} className="flex items-center gap-3 text-sm">
              <span className="w-20 text-gray-600 flex-shrink-0">{new Date(`${d.date}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}</span>
              <div className="flex-1 h-6 bg-gray-100 rounded-md overflow-hidden"><div className="h-full bg-indigo-400 rounded-md" style={{ width: `${(d.sent / maxDay) * 100}%` }} /></div>
              <span className="w-32 text-right text-gray-700 tabular-nums">{d.sent} envoyés · <b className="text-emerald-700">{d.replied}</b> rép.</span>
            </div>
          ))}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="text-left text-gray-500 border-b">
            <th className="p-3 font-medium">Envoi (objet)</th><th className="p-3 font-medium">Date</th><th className="p-3 font-medium text-right">Contactés</th><th className="p-3 font-medium text-right">Remis</th>
            <th className="p-3 font-medium text-right">Réponses</th><th className="p-3 font-medium text-right">Taux</th><th className="p-3 font-medium text-right">+ / −</th><th className="p-3 font-medium text-right">Anti-spam</th><th className="p-3 font-medium text-right">Rebonds</th>
          </tr></thead>
          <tbody>{data.campaigns.map((c) => (
            <tr key={c.id} className="border-b last:border-0">
              <td className="p-3 font-medium text-gray-900">{c.name.split(' · ')[0]}</td><td className="p-3 text-gray-600">{when(c.first_sent_at)}</td>
              <td className="p-3 text-right tabular-nums">{c.contacted}</td><td className="p-3 text-right tabular-nums">{c.delivered}</td>
              <td className="p-3 text-right tabular-nums">{c.replied}</td><td className="p-3 text-right tabular-nums">{pct(c.reply_rate)}</td>
              <td className="p-3 text-right tabular-nums"><span className="text-emerald-700">{c.positive}</span> / <span className="text-red-600">{c.negative}</span></td>
              <td className="p-3 text-right tabular-nums">{c.antispam}</td><td className="p-3 text-right tabular-nums">{c.bounced}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>

      <div>
        <div className="flex items-center gap-3 mb-3">
          <h3 className="font-semibold text-gray-900">Réponses</h3>
          <button onClick={() => setFilter('todo')} className={`text-sm ${filter === 'todo' ? 'font-semibold text-indigo-600' : 'text-gray-500'}`}>À classer ({data.replies.filter((r) => !r.sentiment).length})</button>
          <button onClick={() => setFilter('all')} className={`text-sm ${filter === 'all' ? 'font-semibold text-indigo-600' : 'text-gray-500'}`}>Toutes ({data.replies.length})</button>
        </div>
        {replies.length === 0
          ? <p className="text-sm text-gray-500">{filter === 'todo' ? 'Toutes les réponses sont classées.' : 'Aucune réponse pour l\'instant.'}</p>
          : <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{replies.map((r) => <ReplyRow key={r.id} r={r} />)}</div>}
      </div>

      {data.blocked.length > 0 && (
        <div className="card p-4 space-y-2">
          <h3 className="font-semibold text-gray-900 flex items-center gap-2"><ShieldAlert className="w-4 h-4 text-orange-500" />Bloqués par un anti-spam ({data.blocked.length})</h3>
          <p className="text-xs text-gray-500">Ces artisans n&apos;ont pas reçu ton mail : leur filtre demande de cliquer sur un lien de validation. Ouvre le message et valide pour qu&apos;il soit remis.</p>
          {data.blocked.map((r) => (
            <div key={r.id} className="flex items-center gap-3 text-sm border-t pt-2">
              <b className="text-gray-900">{r.company || r.email}</b><span className="text-xs text-gray-400">{r.campaign}</span>
              <a href={gmailLink(r)} target="_blank" rel="noreferrer" className="ml-auto text-xs text-indigo-600 inline-flex items-center gap-1">Débloquer dans Gmail <ExternalLink className="w-3 h-3" /></a>
            </div>
          ))}
        </div>
      )}

      {data.auto.length > 0 && (
        <div className="card p-4">
          <button onClick={() => setShowAuto((v) => !v)} className="font-semibold text-gray-900">Réponses automatiques ({data.auto.length}) {showAuto ? '▾' : '▸'}</button>
          {showAuto && data.auto.map((r) => (
            <div key={r.id} className="text-sm border-t pt-2 mt-2">
              <b className="text-gray-900">{r.company || r.email}</b> <span className="text-gray-600">{r.reply_snippet}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
