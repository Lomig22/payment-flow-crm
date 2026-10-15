'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, X, Factory, Clock, Loader2, Mic, MicOff, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { fabriqueApi, type FabriqueReel } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

// Fabrique @paymentflow : chaque reel écrit par Claude et rendu sur le VPS arrive ici « à valider ».
// Validé → programmé sur les créneaux du compte agence. Refusé → retiré. Le commentaire (dans les
// deux cas) est transmis à Claude pour les reels suivants.

const FUNNEL: Record<FabriqueReel['funnel'], { label: string; cls: string }> = {
  tofu: { label: 'TOFU · découverte', cls: 'bg-sky-100 text-sky-700' },
  mofu: { label: 'MOFU · éducatif',   cls: 'bg-violet-100 text-violet-700' },
  bofu: { label: 'BOFU · vente',      cls: 'bg-emerald-100 text-emerald-700' },
};
const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

function state(r: FabriqueReel): { label: string; cls: string } {
  if (r.review_status === 'rejected') return { label: 'Refusé', cls: 'bg-red-100 text-red-700' };
  if (r.published_at) return { label: `Publié ${fmt(r.published_at)}`, cls: 'bg-emerald-100 text-emerald-700' };
  if (r.scheduled_at) return { label: `Programmé ${fmt(r.scheduled_at)}`, cls: 'bg-indigo-100 text-indigo-700' };
  if (r.review_status === 'approved') return { label: 'Validé · en attente de créneau', cls: 'bg-indigo-100 text-indigo-700' };
  if (r.video_url) return { label: 'À valider', cls: 'bg-amber-100 text-amber-800' };
  if (r.status === 'rendering' || r.status === 'uploaded') return { label: 'Rendu en cours', cls: 'bg-gray-100 text-gray-600' };
  return { label: r.error ? 'En attente' : 'Écrit, rendu à venir', cls: 'bg-gray-100 text-gray-600' };
}

function ReelCard({ r }: { r: FabriqueReel }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(r.feedback ?? '');
  const review = useMutation({
    mutationFn: (action: 'approve' | 'reject') => fabriqueApi.review(r.id, action, note).then((x) => x.data),
    onSuccess: (d, action) => {
      toast.success(action === 'approve' ? (d.scheduled ? 'Validé et programmé' : 'Validé') : 'Refusé : Claude en tiendra compte');
      qc.invalidateQueries({ queryKey: ['fabrique'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  const st = state(r);
  const canReview = !!r.video_url && r.review_status === 'pending';
  return (
    <div className="card p-4 flex gap-4">
      <div className="w-[180px] flex-shrink-0">
        {r.video_url
          ? <video src={r.video_url} poster={r.cover_url ?? undefined} controls playsInline preload="metadata" className="w-full aspect-[9/16] rounded-xl bg-black object-cover" />
          : <div className="w-full aspect-[9/16] rounded-xl bg-gray-100 flex flex-col items-center justify-center gap-2 text-gray-400 text-xs text-center px-3">
              {r.status === 'rendering' ? <Loader2 className="w-5 h-5 animate-spin" /> : <Clock className="w-5 h-5" />}
              {r.status === 'rendering' ? 'Rendu en cours…' : 'Pas encore rendu'}
            </div>}
      </div>
      <div className="flex-1 min-w-0 flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${FUNNEL[r.funnel].cls}`}>{FUNNEL[r.funnel].label}</span>
          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span>
          <span className="text-xs text-gray-500 inline-flex items-center gap-1">{r.voiced ? <Mic className="w-3 h-3" /> : <MicOff className="w-3 h-3" />}{r.voiced ? 'Voix off' : 'Sans voix'}</span>
          {r.permalink && <a href={r.permalink} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 inline-flex items-center gap-1">Voir sur Instagram <ExternalLink className="w-3 h-3" /></a>}
        </div>
        <p className="font-semibold text-gray-900">{r.topic}</p>
        <p className="text-sm text-gray-600 whitespace-pre-line line-clamp-5">{r.caption}</p>
        {r.error && !r.video_url && <p className="text-xs text-amber-700">{r.error}</p>}
        {r.queue_error && <p className="text-xs text-red-600">{r.queue_error}</p>}
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} disabled={!canReview}
          placeholder={canReview ? 'Ton retour (rythme, texte, voix, visuels…) : Claude l\'appliquera aux prochains reels' : ''}
          className="input text-sm mt-auto disabled:bg-gray-50" />
        {canReview && (
          <div className="flex gap-2">
            <button onClick={() => review.mutate('approve')} disabled={review.isPending} className="btn-primary inline-flex items-center gap-1.5 text-sm"><Check className="w-4 h-4" />Valider et programmer</button>
            <button onClick={() => review.mutate('reject')} disabled={review.isPending} className="btn-secondary inline-flex items-center gap-1.5 text-sm text-red-600"><X className="w-4 h-4" />Refuser</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function FabriquePage() {
  const { data, isLoading } = useQuery({ queryKey: ['fabrique'], queryFn: () => fabriqueApi.list().then((r) => r.data), refetchInterval: 30_000 });
  const [showModel, setShowModel] = useState(true);
  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner /></div>;
  const todo = data.reels.filter((r) => r.video_url && r.review_status === 'pending').length;
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Factory className="w-6 h-6 text-pink-500" />Fabrique de reels · @paymentflow</h1>
        <p className="text-sm text-gray-500 mt-1">Chaque reel écrit par Claude arrive ici après son rendu. Rien n&apos;est publié sans ta validation. {todo > 0 && <b className="text-amber-700">{todo} à valider.</b>}</p>
      </div>

      <div className="card p-4">
        <button onClick={() => setShowModel((v) => !v)} className="font-semibold text-gray-900">Aperçu du modèle {showModel ? '▾' : '▸'}</button>
        {showModel && (
          <div className="mt-3 flex gap-4 items-start">
            <video src={data.preview_url} controls playsInline preload="metadata" className="w-[220px] aspect-[9/16] rounded-xl bg-black" />
            <p className="text-sm text-gray-600 max-w-md">Le modèle actuel (rythme v2, logo et bleu Payment Flow) avec le script et la voix Anatole du prototype que tu avais aimé. Les reels écrits par Claude auront des phrases encore plus courtes, donc des coupes plus rapides.</p>
          </div>
        )}
      </div>

      {data.reels.length === 0
        ? <p className="text-sm text-gray-500">Aucun reel pour l&apos;instant.</p>
        : <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{data.reels.map((r) => <ReelCard key={r.id} r={r} />)}</div>}
    </div>
  );
}
