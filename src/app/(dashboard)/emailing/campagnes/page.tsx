'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Send, Users, Eye, Reply, ThumbsUp, ThumbsDown, AlertTriangle, Plus, Minus } from 'lucide-react';
import toast from 'react-hot-toast';
import { campaignsApi, type EmailCampaign, type EmailCampaignReply } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';
import StatCard from '@/components/ui/StatCard';

// Campagnes envoyées directement par Hermès : contactés, ouvertures, réponses, rebonds, et classement
// positif / négatif de chaque réponse par Lomig. Données remontées toutes les 15 min depuis la boîte Gmail.

const pct = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10} %`);
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

function Kpis({ c }: { c: EmailCampaign }) {
  const untracked = 'non mesuré';
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-7 gap-3">
      <StatCard title="Contactés" value={c.contacted} icon={Users} color="purple" />
      <StatCard title="Ouvertures" value={c.opened ?? untracked} icon={Eye} color="blue" />
      <StatCard title="Taux d'ouverture" value={c.open_tracking ? pct(c.open_rate) : untracked} icon={Eye} color="blue" />
      <StatCard title="Réponses" value={c.replied} icon={Reply} color="green" />
      <StatCard title="Taux de réponse" value={pct(c.reply_rate)} icon={Reply} color="green" />
      <StatCard title="Positives / négatives" value={`${c.positive} / ${c.negative}`} icon={ThumbsUp} color="orange" />
      <StatCard title="Rebonds" value={c.bounced} icon={AlertTriangle} color="red" />
    </div>
  );
}

function ReplyRow({ r }: { r: EmailCampaignReply }) {
  const qc = useQueryClient();
  const set = useMutation({
    mutationFn: (s: 'positive' | 'negative' | null) => campaignsApi.classify(r.id, s),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['email-campaigns'] }),
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
          {r.company && <span className="text-gray-500">{r.email}</span>}
          <span className="text-xs text-gray-400 ml-auto">répondu le {fmt(r.replied_at)}</span>
        </div>
        <p className="text-sm text-gray-700 mt-1 whitespace-pre-line">{r.reply_snippet || '(réponse sans texte)'}</p>
        <a href={`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(`from:${r.email}`)}`} target="_blank" rel="noreferrer" className="text-xs text-indigo-600">Ouvrir dans Gmail</a>
      </div>
    </div>
  );
}

export default function CampagnesPage() {
  const { data, isLoading } = useQuery({ queryKey: ['email-campaigns'], queryFn: () => campaignsApi.list().then((r) => r.data), refetchInterval: 60_000 });
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState<'todo' | 'all'>('todo');
  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner /></div>;
  const c = data.campaigns.find((x) => x.id === sel) ?? data.campaigns[0];
  const replies = data.replies.filter((r) => (!c || r.campaign_id === c.id) && (filter === 'all' || !r.sentiment));
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Send className="w-6 h-6 text-indigo-500" />Emailing · Campagnes</h1>
        <p className="text-sm text-gray-500 mt-1">Les campagnes envoyées par Hermès depuis lomig.guegueniat@gmail.com. Réponses et rebonds lus dans la boîte Gmail toutes les 15 min ; classe chaque réponse avec + ou −.</p>
      </div>
      {!c
        ? <p className="text-sm text-gray-500">Aucune campagne remontée pour l&apos;instant.</p>
        : <>
            <div className="flex flex-wrap gap-2">
              {data.campaigns.map((x) => (
                <button key={x.id} onClick={() => setSel(x.id)} className={`px-3 py-1.5 rounded-lg text-sm border ${x.id === c.id ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-200'}`}>
                  {x.name} · {x.contacted}
                </button>
              ))}
            </div>
            <Kpis c={c} />
            {!c.open_tracking && <p className="text-xs text-gray-500">Ouvertures non mesurées : les mails de cette campagne sont partis en texte brut, sans pixel de suivi.</p>}
            <div>
              <div className="flex items-center gap-3 mb-3">
                <h2 className="font-semibold text-gray-900">Réponses</h2>
                <button onClick={() => setFilter('todo')} className={`text-sm ${filter === 'todo' ? 'font-semibold text-indigo-600' : 'text-gray-500'}`}>À classer ({data.replies.filter((r) => r.campaign_id === c.id && !r.sentiment).length})</button>
                <button onClick={() => setFilter('all')} className={`text-sm ${filter === 'all' ? 'font-semibold text-indigo-600' : 'text-gray-500'}`}>Toutes ({data.replies.filter((r) => r.campaign_id === c.id).length})</button>
                <span className="text-xs text-gray-400 ml-auto inline-flex items-center gap-1"><ThumbsUp className="w-3 h-3" />{c.positive} <ThumbsDown className="w-3 h-3 ml-2" />{c.negative}</span>
              </div>
              {replies.length === 0
                ? <p className="text-sm text-gray-500">{filter === 'todo' ? 'Toutes les réponses sont classées.' : 'Aucune réponse pour l\'instant.'}</p>
                : <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">{replies.map((r) => <ReplyRow key={r.id} r={r} />)}</div>}
            </div>
          </>}
    </div>
  );
}
