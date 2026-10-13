'use client';
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Repeat, ChevronDown, ChevronUp, Loader2, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import api, { queueApi } from '@/lib/api';

// « Republier les meilleurs reels » : reels publiés depuis au moins 3 semaines, classés
// par vues ; un clic crée une nouvelle entrée de la file (vidéo récupérée sur Instagram,
// nettoyée, nouvelle légende) qui suit ensuite le circuit normal (valider / programmer).
interface Candidate {
  ig_media_id: string; caption: string | null; permalink: string | null; thumbnail_url: string | null;
  published_at: string; views: number | null; likes: number | null; comments: number | null; shares: number | null; saved: number | null;
}

const fmt = (n: number | null) => (n ?? 0).toLocaleString('fr-FR');

export default function RepublishTop({ onAdded }: { onAdded: () => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<Record<string, string>>({});   // ig_media_id → étape
  const { data } = useQuery({
    queryKey: ['republish-candidates'],
    queryFn:  () => api.get<{ min_age_days: number; candidates: Candidate[] }>('/instagram/republish').then((r) => r.data),
    enabled:  open,
  });

  const republish = async (c: Candidate) => {
    const step = (s: string) => setBusy((b) => ({ ...b, [c.ig_media_id]: s }));
    try {
      step('Récupération de la vidéo…');
      const { data: created } = await api.post<{ id: string }>('/instagram/republish', { ig_media_id: c.ig_media_id });
      step('Nettoyage…');
      await queueApi.process(created.id);
      step('Nouvelle légende…');
      await queueApi.caption(created.id).catch(() => toast.error('Légende automatique impossible : à écrire dans la file'));
      toast.success('Ajouté à la file « À valider » : relis la légende puis programme-le');
      qc.invalidateQueries({ queryKey: ['republish-candidates'] });
      onAdded();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? e.message ?? 'Republication impossible');
    } finally {
      setBusy((b) => { const { [c.ig_media_id]: _, ...rest } = b; return rest; });
    }
  };

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen((v) => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        <Repeat className="w-4 h-4 text-primary-600" />
        <span className="text-sm font-semibold text-gray-900">Republier les meilleurs reels</span>
        <span className="text-xs text-gray-500">reels de plus de 3 semaines, classés par vues — une seule republication par reel</span>
        {open ? <ChevronUp className="w-4 h-4 ml-auto text-gray-400" /> : <ChevronDown className="w-4 h-4 ml-auto text-gray-400" />}
      </button>
      {open && (
        <div className="border-t border-gray-100 divide-y divide-gray-50 max-h-[28rem] overflow-y-auto">
          {!data ? (
            <p className="p-6 text-center text-sm text-gray-400">Chargement…</p>
          ) : data.candidates.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">Aucun reel éligible pour l&apos;instant.</p>
          ) : data.candidates.map((c, i) => (
            <div key={c.ig_media_id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-5 text-xs text-gray-400 text-right">{i + 1}</span>
              {c.thumbnail_url
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={c.thumbnail_url} alt="" className="w-9 h-12 object-cover rounded bg-gray-100 flex-shrink-0" />
                : <div className="w-9 h-12 rounded bg-gray-100 flex-shrink-0" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-gray-800">{(c.caption ?? '').split('\n')[0] || 'Sans légende'}</p>
                <p className="text-[11px] text-gray-500">
                  {fmt(c.views)} vues · {fmt(c.likes)} j&apos;aime · {fmt(c.comments)} comm. · {fmt(c.shares)} partages · publié le {new Date(c.published_at).toLocaleDateString('fr-FR')}
                </p>
              </div>
              {c.permalink && (
                <a href={c.permalink} target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-gray-600" title="Voir sur Instagram">
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
              <button onClick={() => republish(c)} disabled={!!busy[c.ig_media_id]} className="btn-secondary btn-sm whitespace-nowrap">
                {busy[c.ig_media_id] ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> {busy[c.ig_media_id]}</> : <><Repeat className="w-3.5 h-3.5" /> Republier</>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
