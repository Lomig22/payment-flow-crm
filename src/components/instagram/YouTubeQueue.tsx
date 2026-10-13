'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Youtube, ExternalLink, AlertTriangle } from 'lucide-react';
import api from '@/lib/api';

// Section « YouTube Shorts » de la page Publication : file d'envoi et quota du jour
interface Item { key: string; title: string; source: 'nouveau' | 'historique'; date: string | null; thumbnail: string | null; instagram: string | null; status: string; url?: string; warning?: string; error?: string }
interface Data { connected: boolean; channel?: string | null; quota?: { sent: number | null; limit: number; exhausted: boolean }; pending?: Item[]; done?: Item[]; skipped?: number; failed?: Item[] }

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) : '');

function Row({ i, rank }: { i: Item; rank?: number }) {
  return (
    <div className="flex items-center gap-3 px-4 py-2 text-sm">
      {rank != null && <span className="w-6 text-xs text-gray-400 text-right">{rank}</span>}
      {i.thumbnail
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={i.thumbnail} alt="" className="w-8 h-11 object-cover rounded bg-gray-100 flex-shrink-0" />
        : <div className="w-8 h-11 rounded bg-gray-100 flex-shrink-0" />}
      <div className="min-w-0 flex-1">
        <p className="truncate text-gray-800">{i.title}</p>
        <p className="text-[11px] text-gray-400">
          {i.source === 'nouveau' ? (i.status === 'scheduled' ? 'Nouveau reel programmé' : 'Nouveau reel') : 'Historique'} · Instagram {fmt(i.date)}
          {i.error && i.status !== 'done' && <span className="text-amber-600"> · {i.error}</span>}
        </p>
      </div>
      {i.warning && <span className="badge bg-amber-100 text-amber-700" title={i.warning}>Privé</span>}
      {i.url && <a href={i.url} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-red-600"><ExternalLink className="w-4 h-4" /></a>}
    </div>
  );
}

export default function YouTubeQueue() {
  const [tab, setTab] = useState<'pending' | 'done'>('pending');
  const { data } = useQuery({
    queryKey: ['youtube-queue'],
    queryFn:  () => api.get<Data>('/instagram/youtube-queue').then((r) => r.data),
    refetchInterval: 60_000,
  });
  if (!data?.connected) return null;
  const list = tab === 'pending' ? data.pending ?? [] : data.done ?? [];

  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3 border-b border-gray-100">
        <Youtube className="w-4 h-4 text-red-600" />
        <p className="text-sm font-semibold text-gray-900">YouTube Shorts{data.channel ? ` — ${data.channel}` : ''}</p>
        <span className={`text-xs ${data.quota?.exhausted ? 'text-amber-600' : 'text-gray-500'}`}>
          {data.quota?.exhausted ? `${data.quota.limit}/${data.quota.limit} Shorts aujourd'hui · reprise demain vers 9 h` : `Aujourd'hui : ${data.quota?.sent ?? 0}/${data.quota?.limit} Shorts`}
        </span>
        <div className="ml-auto flex gap-1.5">
          {(['pending', 'done'] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-2.5 py-1 rounded-md text-xs font-medium ${tab === t ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {t === 'pending' ? `En attente (${data.pending?.length ?? 0})` : `Envoyés (${data.done?.length ?? 0})`}
            </button>
          ))}
        </div>
      </div>
      {tab === 'pending' && (
        <p className="px-4 py-2 text-[11px] text-gray-500 bg-gray-50">
          Ordre d&apos;envoi : les nouveaux reels d&apos;abord, puis l&apos;historique du plus récent au plus ancien, 10 Shorts par jour maximum, espacés d&apos;au moins 45 minutes.
          {data.skipped ? ` ${data.skipped} reel(s) ignoré(s) : musique de la bibliothèque Instagram (vidéo non fournie).` : ''}
        </p>
      )}
      <div className="divide-y divide-gray-50 max-h-96 overflow-y-auto">
        {list.length === 0
          ? <p className="p-6 text-center text-sm text-gray-400">{tab === 'pending' ? 'Rien en attente.' : 'Aucun Short envoyé pour l’instant.'}</p>
          : list.map((i, n) => <Row key={i.key} i={i} rank={tab === 'pending' ? n + 1 : undefined} />)}
      </div>
      {!!data.failed?.length && (
        <p className="px-4 py-2 text-xs text-red-600 flex items-center gap-1.5 border-t border-gray-100">
          <AlertTriangle className="w-3.5 h-3.5" /> {data.failed.length} envoi(s) en échec après 3 essais : {data.failed[0].error}
        </p>
      )}
    </div>
  );
}
