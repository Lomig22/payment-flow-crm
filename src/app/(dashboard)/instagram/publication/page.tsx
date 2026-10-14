'use client';
import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Upload, Film, CircleDot, Send, Trash2, RotateCcw, ExternalLink, ShieldCheck,
  ChevronDown, ChevronUp, Clock, AlertTriangle, Loader2, FileVideo, Sparkles, MapPin, CalendarCheck, Bot, Eye, X,
} from 'lucide-react';
import toast from 'react-hot-toast';
import api, { queueApi, uploadToSignedUrl, type QueueItem, type QueueStatus, type PublishingSettings } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Spinner from '@/components/ui/Spinner';
import ReelPreview from '@/components/instagram/ReelPreview';
import VoiceoverPanel from '@/components/instagram/VoiceoverPanel';
import YouTubeQueue from '@/components/instagram/YouTubeQueue';
import RepublishTop from '@/components/instagram/RepublishTop';
import InstagramAccounts from '@/components/instagram/InstagramAccounts';

const STATUS_META: Record<QueueStatus, { label: string; cls: string }> = {
  uploading:  { label: 'Envoi ou traitement en cours', cls: 'bg-gray-100 text-gray-600' },
  draft:      { label: 'À valider',      cls: 'bg-violet-100 text-violet-700' },
  scheduled:  { label: 'Programmé',      cls: 'bg-blue-100 text-blue-700' },
  publishing: { label: 'Publication…',   cls: 'bg-amber-100 text-amber-700' },
  published:  { label: 'Publié',         cls: 'bg-green-100 text-green-700' },
  failed:     { label: 'Échec',          cls: 'bg-red-100 text-red-700' },
};

const pad = (n: number) => String(n).padStart(2, '0');
const toLocalInput = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fmtWhen = (iso: string) =>
  new Date(iso).toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const fmtSize = (b: number | null) => (b ? `${(b / 1_048_576).toFixed(1)} Mo` : '');
const MAX_UPLOAD_BYTES = 50 * 1_048_576;   // limite par fichier du stockage Supabase (offre gratuite)

interface FileJob { name: string; state: 'waiting' | 'upload' | 'queued' | 'skipped' | 'error' | 'cancelled'; progress: number; error?: string }

const JOB_LABEL: Record<FileJob['state'], string> = {
  waiting: 'En attente', upload: 'Envoi', queued: 'Envoyée : traitement en arrière-plan', skipped: 'Déjà dans la file ✓',
  error: 'Erreur', cancelled: 'Annulé',
};

// Compte perso de Lomig : les blocs qui ne concernent que lui (fin CTA, YouTube, republication)
const PERSONAL = 'lomig_guegueniat';

// Une page par compte Instagram : /instagram/publication/<compte> (sans compte : compte perso)
export default function PublicationPage() {
  const params  = useParams<{ account?: string }>();
  const account = params?.account ? decodeURIComponent(params.account) : PERSONAL;
  const personal = account === PERSONAL;
  const qc      = useQueryClient();
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const fileRef = useRef<HTMLInputElement>(null);

  const [format, setFormat]   = useState<'reel' | 'story'>('reel');
  const [files, setFiles]     = useState<File[]>([]);
  const [caption, setCaption] = useState('');
  const [jobs, setJobs]       = useState<FileJob[]>([]);
  const busy = jobs.some((j) => !['queued', 'skipped', 'error', 'cancelled'].includes(j.state));

  // Annulation : fichiers à ne pas traiter + envoi en cours interrompu
  const cancelled = useRef<Set<number>>(new Set());
  const current   = useRef<{ index: number; abort: AbortController } | null>(null);
  const cancelJob = (i: number) => {
    cancelled.current.add(i);
    if (current.current?.index === i) current.current.abort.abort();
    else setJobs((js) => js.map((j, k) => (k === i && j.state === 'waiting' ? { ...j, state: 'cancelled' } : j)));
  };
  const cancelAll = () => jobs.forEach((j, i) => { if (!['queued', 'skipped', 'error', 'cancelled'].includes(j.state)) cancelJob(i); });

  const { data: queue = [], isLoading } = useQuery({
    queryKey: ['content-queue', account],
    queryFn:  () => queueApi.list(account).then((r) => r.data),
    enabled:  isAdmin,
    refetchInterval: (q) => (q.state.data ?? []).some((i) => ['uploading', 'publishing'].includes(i.status)) ? 10_000 : 60_000,
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['content-queue', account] });
  const setJob  = (i: number, patch: Partial<FileJob>) =>
    setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));

  // Chaque vidéo : envoi → nettoyage → légende automatique (reels sans légende) → « À valider »
  // Chaque vidéo : envoi → nettoyage → légende automatique (reels sans légende) → « À valider ».
  // Annulable à tout moment : l'envoi est interrompu, l'entrée et ses fichiers sont supprimés.
  const submit = async () => {
    if (!files.length) return toast.error('Choisissez au moins une vidéo');
    const list = files;
    cancelled.current = new Set();
    setJobs(list.map((f) => ({ name: f.name, state: 'waiting', progress: 0 })));
    let ok = 0;
    for (let i = 0; i < list.length; i++) {
      if (cancelled.current.has(i)) continue;
      const file  = list[i];
      const abort = new AbortController();
      current.current = { index: i, abort };
      let createdId: string | null = null;
      const stopIfCancelled = async () => {
        if (!cancelled.current.has(i)) return false;
        if (createdId) await queueApi.remove(createdId).catch(() => { /* nettoyage automatique sous 1 h */ });
        setJob(i, { state: 'cancelled' });
        return true;
      };
      // Limite du stockage (offre gratuite Supabase) : 50 Mo par fichier. Sans ce contrôle, le
      // refus du stockage s'affichait en « Network Error ».
      if (file.size > MAX_UPLOAD_BYTES) {
        setJob(i, { state: 'error', error: `vidéo de ${Math.round(file.size / 1_048_576)} Mo : 50 Mo maximum. Télécharge-la en qualité standard (pas HD) ou compresse-la, puis redépose-la.` });
        continue;
      }
      try {
        setJob(i, { state: 'upload' });
        const { data: created } = await queueApi.create({
          account,
          format, caption: format === 'reel' && list.length === 1 ? caption : undefined,
          scheduled_at: null, file_name: file.name, file_size: file.size,
        });
        createdId = created.id;
        if (await stopIfCancelled()) continue;
        await uploadToSignedUrl(created.upload_url, file, (p) => setJob(i, { progress: p }), abort.signal);
        if (await stopIfCancelled()) continue;
        // Nettoyage, fin CTA, analyse audio, anti-doublon et légende : faits en arrière-plan par le
        // serveur (une vidéo à la fois), la page peut être fermée une fois les envois terminés
        await queueApi.markUploaded(created.id);
        setJob(i, { state: 'queued' });
        ok++;
      } catch (e: any) {
        // Fichier déjà envoyé (déjà programmé ou publié) : rien à refaire, pas une erreur
        if (e.response?.status === 409 && !createdId) { setJob(i, { state: 'skipped' }); continue; }
        if (e.name === 'AbortError' || cancelled.current.has(i)) await stopIfCancelled();
        else setJob(i, { state: 'error', error: e.response?.data?.message ?? e.message });
      } finally {
        current.current = null;
        refresh();
      }
    }
    if (ok) toast.success(`${ok} vidéo(s) envoyée(s) : elles arrivent dans « À valider » au fil du traitement (1 à 2 par minute), la page peut être fermée`);
    setFiles([]); setCaption('');
    if (fileRef.current) fileRef.current.value = '';
  };

  // Validation : mêmes créneaux que le pilote automatique (calculés côté serveur)
  const validateAll = useMutation({
    mutationFn: async (_drafts: QueueItem[]) => (await queueApi.scheduleDrafts(account)).data,
    onSuccess: ({ scheduled, blocked, no_caption }) => {
      if (scheduled) toast.success(`${scheduled} contenu(s) programmé(s)`);
      // Rien de programmé : on dit pourquoi
      if (blocked.length) {
        const who = blocked.map((b) => (b.file_name ?? '').split(' - ')[0]).join(', ');
        toast.error(`${blocked.length} reel(s) en attente de voix off française : ${who}`, { duration: 7000 });
      }
      if (no_caption) toast.error(`${no_caption} reel(s) sans légende : à écrire avant de programmer`);
      if (!scheduled && !blocked.length && !no_caption) toast.error('Aucun créneau libre dans les prochains jours');
      refresh();
    },
    onError:   (e: any) => { toast.error(e.response?.data?.message ?? 'Erreur'); refresh(); },
  });

  if (!isAdmin) return <div className="card p-8 text-center text-gray-500">Page réservée aux administrateurs.</div>;

  const upcoming = queue.filter((q) => ['uploading', 'draft', 'scheduled', 'publishing'].includes(q.status));
  const drafts   = upcoming.filter((q) => q.status === 'draft' && (q.format === 'story' || q.caption));
  const past     = queue.filter((q) => ['published', 'failed'].includes(q.status))
    .sort((a, b) => (b.published_at ?? b.created_at).localeCompare(a.published_at ?? a.created_at));

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-2">
        <h1 className="text-xl font-bold text-gray-900">Publication · @{account}</h1>
      </div>
      <InstagramAccounts />
      <AutoScheduleCard onChange={refresh} account={account} />
      <PlatformsCard />
      {personal && <EndCardCard />}
      {personal && <YouTubeQueue />}
      {personal && <RepublishTop onAdded={refresh} />}

      {/* Dépôt des vidéos */}
      <div className="card p-5 space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Upload className="w-4 h-4 text-gray-500" />
          <h2 className="text-sm font-semibold text-gray-900">Déposer des vidéos</h2>
          <span className="ml-auto text-xs text-gray-400 flex items-center gap-1">
            <ShieldCheck className="w-3.5 h-3.5 text-green-500" /> Métadonnées retirées sans perte
            <Sparkles className="w-3.5 h-3.5 text-violet-500 ml-2" /> Légende automatique
          </span>
        </div>

        <div className="flex gap-2">
          {(['reel', 'story'] as const).map((f) => (
            <button key={f} onClick={() => setFormat(f)} disabled={busy}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                format === f ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              {f === 'reel' ? <Film className="w-4 h-4" /> : <CircleDot className="w-4 h-4" />}
              {f === 'reel' ? 'Reels' : 'Stories'}
            </button>
          ))}
        </div>

        <label className="flex items-center gap-3 p-4 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-primary-300 transition-colors">
          <FileVideo className="w-5 h-5 text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-600">
            {files.length === 0 ? 'Choisir une ou plusieurs vidéos MP4 / MOV'
              : files.length === 1 ? `${files[0].name} (${fmtSize(files[0].size)})`
              : `${files.length} vidéos (${fmtSize(files.reduce((s, f) => s + f.size, 0))})`}
          </span>
          <input ref={fileRef} type="file" multiple accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" disabled={busy}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
        </label>

        {format === 'reel' && files.length === 1 && (
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200} disabled={busy}
            className="input min-h-[80px] resize-y"
            placeholder="Laisser vide : la légende et les hashtags sont écrits automatiquement à partir de la vidéo." />
        )}
        {format === 'story' && (
          <p className="text-xs text-gray-500 bg-amber-50 border border-amber-100 rounded-lg p-3">
            Les stories publiées par l&apos;API n&apos;ont ni légende ni sticker. Pour une story avec sticker,
            publiez-la depuis l&apos;app : elle sera comptée automatiquement.
          </p>
        )}

        <div className="flex items-center gap-3">
          {busy && (
            <button onClick={cancelAll} className="btn-secondary">
              <X className="w-4 h-4" /> Tout annuler
            </button>
          )}
          <button onClick={submit} disabled={busy || !files.length} className="btn-primary">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
            {busy ? 'Traitement…' : 'Ajouter à la file'}
          </button>
          <p className="text-xs text-gray-400">Les vidéos arrivent « À valider » : relisez les légendes, puis programmez tout d&apos;un clic.</p>
        </div>

        {jobs.length > 0 && (
          <div className="space-y-1.5">
            {jobs.map((j, i) => (
              <div key={i} className="flex items-center gap-3 text-xs">
                <span className="truncate max-w-[220px] text-gray-700">{j.name}</span>
                <span className={j.state === 'error' ? 'text-red-600' : ['queued', 'skipped'].includes(j.state) ? 'text-green-600' : j.state === 'cancelled' ? 'text-gray-400 line-through' : 'text-gray-500'}>
                  {j.state === 'upload' ? `Envoi ${j.progress} %` : JOB_LABEL[j.state]}{j.error ? ` : ${j.error}` : ''}
                </span>
                {!['queued', 'skipped', 'error', 'waiting', 'cancelled'].includes(j.state) && <Loader2 className="w-3 h-3 animate-spin text-gray-400" />}
                {!['queued', 'skipped', 'error', 'cancelled'].includes(j.state) && (
                  <button onClick={() => cancelJob(i)} className="text-gray-400 hover:text-red-600" title="Annuler cette vidéo">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* À venir */}
      <div>
        <div className="flex flex-wrap items-center gap-2 mb-2">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">À venir ({upcoming.length})</p>
          {drafts.length > 0 && (
            <button onClick={() => validateAll.mutate(drafts)} disabled={validateAll.isPending} className="btn-primary btn-sm ml-auto">
              {validateAll.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CalendarCheck className="w-3.5 h-3.5" />}
              Valider et programmer les {drafts.length} contenu(s)
            </button>
          )}
        </div>
        <div className="card divide-y divide-gray-50">
          {isLoading ? <div className="p-6 flex justify-center"><Spinner className="w-6 h-6" /></div>
            : upcoming.length === 0 ? <p className="p-6 text-center text-sm text-gray-400">Rien dans la file.</p>
            : upcoming.map((q) => <QueueRow key={q.id} q={q} onChange={refresh} />)}
        </div>
      </div>

      {past.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Publiés et échecs — 7 derniers jours</p>
          <div className="card divide-y divide-gray-50">
            {past.map((q) => <QueueRow key={q.id} q={q} onChange={refresh} />)}
          </div>
        </div>
      )}
    </div>
  );
}

function QueueRow({ q, onChange }: { q: QueueItem; onChange: () => void }) {
  const [open, setOpen]       = useState(false);
  const [preview, setPreview] = useState(false);
  const [caption, setCaption] = useState(q.caption ?? '');
  const status   = STATUS_META[q.status];
  const report   = q.clean_report;
  const removed  = report ? Object.keys(report.removed_tags).length + report.removed_streams.length : 0;
  const editable = q.status === 'draft' || q.status === 'scheduled';

  const act = useMutation({
    mutationFn: async (action: 'publish' | 'delete' | 'retry' | 'schedule' | 'draft') => {
      if (action === 'publish') {
        // Appels courts répétés tant qu'Instagram traite la vidéo (3 min maximum)
        const started = Date.now();
        const tid = toast.loading('Envoi à Instagram…');
        try {
          let res = (await queueApi.publish(q.id)).data;
          while (res.status === 'publishing' && Date.now() - started < 180_000) {
            toast.loading(`Instagram traite la vidéo… (${Math.round((Date.now() - started) / 1000)} s)`, { id: tid });
            await new Promise((r) => setTimeout(r, 5000));
            res = (await queueApi.publish(q.id)).data;
          }
          return res;
        } finally {
          toast.dismiss(tid);
        }
      }
      if (action === 'delete')   return (await queueApi.remove(q.id)).data;
      if (action === 'retry' || action === 'schedule') {
        const future = q.scheduled_at && new Date(q.scheduled_at).getTime() > Date.now();
        return (await queueApi.update(q.id, { status: 'scheduled', ...(future ? {} : { scheduled_at: new Date(Date.now() + 5 * 60_000).toISOString() }) })).data;
      }
      return (await queueApi.update(q.id, { status: 'draft' })).data;
    },
    onSuccess: (res: any, action) => {
      if (action === 'publish') {
        if (res?.status === 'published') toast.success('Publié sur Instagram ✅');
        else if (res?.status === 'failed') toast.error(res.error ?? 'Échec de la publication');
        else toast("Instagram traite encore la vidéo : elle sera publiée automatiquement d'ici quelques minutes", { icon: '⏳' });
      }
      onChange();
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });

  const saveCaption = useMutation({
    mutationFn: (text: string) => queueApi.update(q.id, { caption: text }),
    onSuccess:  () => { toast.success('Légende enregistrée'); onChange(); },
    onError:    (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });

  const rewrite = useMutation({
    mutationFn: () => queueApi.caption(q.id, true).then((r) => r.data),
    onSuccess:  (d) => { setCaption(d.caption); toast.success('Nouvelle légende'); onChange(); },
    onError:    (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });

  const updateTime = useMutation({
    mutationFn: (value: string) => queueApi.update(q.id, { scheduled_at: new Date(value).toISOString() }),
    onSuccess:  () => { toast.success('Heure mise à jour'); onChange(); },
    onError:    (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-center gap-3">
        {q.format === 'reel' ? <Film className="w-4 h-4 text-pink-500" /> : <CircleDot className="w-4 h-4 text-amber-500" />}
        <span className={`badge ${status.cls}`}>{status.label}</span>
        {editable && q.scheduled_at ? (
          <input type="datetime-local" defaultValue={toLocalInput(new Date(q.scheduled_at))}
            onBlur={(e) => { if (e.target.value && new Date(e.target.value).toISOString() !== q.scheduled_at) updateTime.mutate(e.target.value); }}
            className="input w-auto py-1 text-xs" />
        ) : (q.published_at || q.scheduled_at) && (
          <span className="text-xs text-gray-500 flex items-center gap-1 capitalize">
            <Clock className="w-3 h-3" /> {fmtWhen(q.published_at ?? q.scheduled_at!)}
          </span>
        )}
        {(['facebook', 'youtube', 'tiktok'] as const).map((p) => {
          const st = q.crosspost?.[p];
          if (!st) return null;
          const label = p === 'facebook' ? 'Facebook' : p === 'youtube' ? 'YouTube' : 'TikTok';
          const cls = st.status === 'done' ? (st.warning ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700')
            : st.status === 'failed' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600';
          const text = st.status === 'done' ? `${label} ✓` : st.status === 'failed' ? `${label} ✗` : `${label}…`;
          return st.url
            ? <a key={p} href={st.url} target="_blank" rel="noopener noreferrer" className={`badge ${cls}`} title={st.warning ?? st.error}>{text}</a>
            : <span key={p} className={`badge ${cls}`} title={st.error ?? 'Cross-post en attente'}>{text}</span>;
        })}
        {q.caption_ai?.place_guess && (
          <span className="badge bg-gray-100 text-gray-600"><MapPin className="w-3 h-3" /> {q.caption_ai.place_guess}</span>
        )}
        <span className="text-xs text-gray-400 truncate max-w-[200px]">{q.file_name} {fmtSize(q.file_size)}</span>

        <div className="ml-auto flex items-center gap-1.5">
          {q.media_url && q.status !== 'published' && (
            <button onClick={() => setPreview(true)} className="btn-secondary btn-sm">
              <Eye className="w-3.5 h-3.5" /> Aperçu
            </button>
          )}
          {q.status === 'published' && q.permalink && (
            <a href={q.permalink} target="_blank" rel="noopener noreferrer" className="btn-secondary btn-sm">
              <ExternalLink className="w-3.5 h-3.5" /> Voir
            </a>
          )}
          {editable && (
            <button onClick={() => act.mutate('publish')} disabled={act.isPending} className="btn-secondary btn-sm">
              {act.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Publier maintenant
            </button>
          )}
          {q.status === 'scheduled' && (
            <button onClick={() => act.mutate('draft')} disabled={act.isPending} className="btn-secondary btn-sm">Mettre en pause</button>
          )}
          {q.status === 'failed' && q.lossless && (
            <button onClick={() => act.mutate('retry')} disabled={act.isPending} className="btn-secondary btn-sm">
              <RotateCcw className="w-3.5 h-3.5" /> Réessayer
            </button>
          )}
          {q.status !== 'publishing' && q.status !== 'published' && (
            <button onClick={() => { if (confirm('Supprimer cette vidéo de la file ?')) act.mutate('delete'); }}
              disabled={act.isPending} className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" title="Supprimer">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {q.format === 'reel' && editable ? (
        <div className="mt-2">
          <textarea value={caption} onChange={(e) => setCaption(e.target.value)} maxLength={2200}
            onBlur={() => { if (caption !== (q.caption ?? '')) saveCaption.mutate(caption); }}
            className="input min-h-[96px] resize-y text-sm" placeholder="Légende du reel…" />
          <div className="flex items-center gap-2 mt-1">
            <button onClick={() => rewrite.mutate()} disabled={rewrite.isPending}
              className="text-xs text-violet-700 flex items-center gap-1 hover:underline">
              {rewrite.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              {q.caption ? 'Réécrire la légende' : 'Écrire la légende'}
            </button>
            {q.caption_source === 'ai' && <span className="text-[11px] text-gray-400">Écrite automatiquement</span>}
            {q.caption_source === 'ai_edited' && <span className="text-[11px] text-gray-400">Écrite automatiquement, retouchée</span>}
            <span className="text-[11px] text-gray-400 ml-auto">{caption.length} / 2 200</span>
          </div>
        </div>
      ) : q.caption && (
        <p className="mt-2 text-sm text-gray-700 line-clamp-2 whitespace-pre-line">{q.caption}</p>
      )}

      {q.format === 'reel' && editable && <VoiceoverPanel q={q} onChange={onChange} />}

      {q.error && (
        <p className="mt-2 text-xs text-red-600 flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" /> {q.error}
        </p>
      )}

      <ReelPreview open={preview} onClose={() => setPreview(false)} account={q.account_username}
        videoUrl={q.media_url} coverUrl={q.cover_url} caption={editable ? caption : q.caption} format={q.format} />

      {report && (
        <div className="mt-2">
          <button onClick={() => setOpen((v) => !v)} className="text-xs text-green-700 flex items-center gap-1 hover:underline">
            <ShieldCheck className="w-3.5 h-3.5" />
            {removed} métadonnée(s) retirée(s) · {report.lossless ? 'vidéo et son identiques au bit près' : 'contrôle échoué'}
            {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
          {open && (
            <div className="mt-2 p-3 bg-gray-50 rounded-lg text-xs text-gray-600 space-y-2 font-mono break-all">
              <div>
                <p className="font-sans font-semibold text-gray-700 mb-1">Retiré</p>
                {removed === 0 ? <p>Aucune métadonnée trouvée dans le fichier.</p> : (
                  <>
                    {Object.entries(report.removed_tags).map(([k, v]) => <p key={k}>{k} = {v}</p>)}
                    {report.removed_streams.map((s) => <p key={s}>{s}</p>)}
                  </>
                )}
              </div>
              <div>
                <p className="font-sans font-semibold text-gray-700 mb-1">Empreintes SHA-256 (avant → après)</p>
                {report.hashes_before.map((h, i) => (
                  <p key={h}>{h === report.hashes_after[i] ? '✅' : '❌'} {h}</p>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// Pilote automatique : les contenus prêts (reel avec légende, story) sont programmés seuls
function AutoScheduleCard({ onChange, account }: { onChange: () => void; account: string }) {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['publishing-settings', account], queryFn: () => queueApi.settings(account).then((r) => r.data) });
  const save = useMutation({
    mutationFn: (s: PublishingSettings) => queueApi.saveSettings(s, account).then((r) => r.data),
    onSuccess:  (d) => {
      qc.setQueryData(['publishing-settings', account], d);
      toast.success(d.auto_schedule
        ? `Pilote automatique activé${d.scheduled ? ` : ${d.scheduled} contenu(s) programmé(s)` : ''}`
        : 'Pilote automatique désactivé');
      onChange();
    },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });
  if (!data) return null;
  const set = (patch: Partial<PublishingSettings>) => save.mutate({ ...data, ...patch });

  return (
    <div className={`card p-4 flex flex-wrap items-center gap-3 ${data.auto_schedule ? 'border-green-300 bg-green-50/40' : ''}`}>
      <Bot className={`w-5 h-5 ${data.auto_schedule ? 'text-green-600' : 'text-gray-400'}`} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-gray-900">Pilote automatique {data.auto_schedule ? 'activé' : 'désactivé'} — créneaux des reels</p>
        <p className="text-xs text-gray-500">
          {data.auto_schedule
            ? 'Chaque vidéo prête (légende écrite) est programmée et publiée seule, sans validation.'
            : 'Les vidéos restent « À valider » jusqu\'à votre clic sur « Valider et programmer ».'}
        </p>
      </div>
      <button onClick={() => set({ auto_schedule: !data.auto_schedule })} disabled={save.isPending}
        className={`ml-auto ${data.auto_schedule ? 'btn-secondary btn-sm' : 'btn-primary btn-sm'}`}>
        {data.auto_schedule ? 'Désactiver' : 'Activer'}
      </button>

      {/* Grille des créneaux reels : clic = libre → prioritaire → remplissage → libre */}
      <div className="w-full">
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
            const prio = data.reel_slots.includes(h);
            const rank = data.filler_slots.indexOf(h);
            const cycle = () => {
              if (prio) set({ reel_slots: data.reel_slots.filter((x) => x !== h), filler_slots: [...data.filler_slots, h] });
              else if (rank >= 0) set({ filler_slots: data.filler_slots.filter((x) => x !== h) });
              else set({ reel_slots: [...data.reel_slots, h] });
            };
            return (
              <button key={h} onClick={cycle} disabled={save.isPending}
                title={prio ? 'Créneau prioritaire' : rank >= 0 ? `Remplissage n° ${rank + 1}` : 'Créneau libre'}
                className={`w-12 py-1 rounded-md text-xs font-medium border transition-colors ${
                  prio ? 'bg-primary-600 text-white border-primary-600'
                  : rank >= 0 ? 'bg-primary-50 text-primary-700 border-primary-200'
                  : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'}`}>
                {h} h{rank >= 0 && <sup className="ml-0.5">{rank + 1}</sup>}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-gray-500 mt-1.5">
          <span className="inline-block w-2 h-2 rounded-sm bg-primary-600 mr-1" />Prioritaires ({data.reel_slots.length}) : remplis en premier chaque jour
          <span className="inline-block w-2 h-2 rounded-sm bg-primary-50 border border-primary-200 ml-3 mr-1" />Remplissage : utilisés dans l&apos;ordre (n°) quand il y a plus de reels
          <span className="ml-3">Un clic change l&apos;état d&apos;une heure.</span>
        </p>
      </div>
    </div>
  );
}

// Cross-post : plateformes connectées + connexion TikTok (OAuth, retour sur cette page)
function PlatformsCard() {
  const { data } = useQuery({ queryKey: ['crosspost-platforms'], queryFn: () => queueApi.platforms().then((r) => r.data) });
  useEffect(() => {
    const msg = new URLSearchParams(window.location.search).get('tiktok');
    if (!msg) return;
    (msg.startsWith('connecté') ? toast.success : toast.error)(`TikTok ${msg}`);
    window.history.replaceState(null, '', window.location.pathname);
  }, []);
  const connect = useMutation({
    mutationFn: () => queueApi.tiktokAuthUrl().then((r) => r.data.url),
    onSuccess:  (url) => { window.location.href = url; },
    onError:    (e: any) => toast.error(e.response?.data?.message ?? 'Connexion TikTok impossible'),
  });
  if (!data) return null;
  const rows = [
    { key: 'facebook', label: 'Page Facebook' },
    { key: 'youtube',  label: 'YouTube Shorts' },
    { key: 'tiktok',   label: 'TikTok' },
  ] as const;
  return (
    <div className="card p-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm">
      <span className="font-semibold text-gray-900">Cross-post</span>
      {rows.map(({ key, label }) => (
        <span key={key} className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${data[key].connected ? 'bg-green-500' : 'bg-gray-300'}`} />
          <span className="text-gray-700">{label}</span>
          <span className="text-xs text-gray-400">{data[key].connected ? data[key].name ?? 'connecté' : 'non connecté'}</span>
        </span>
      ))}
      {data.tiktok.can_connect && (
        <button onClick={() => connect.mutate()} disabled={connect.isPending} className="btn-secondary btn-sm ml-auto">
          {data.tiktok.connected ? 'Reconnecter TikTok' : 'Connecter TikTok'}
        </button>
      )}
    </div>
  );
}

// Séquence de fin CTA (« Commente DEVIS ») : montée une fois, ajoutée à la fin de chaque reel
function EndCardCard() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const { data } = useQuery({ queryKey: ['end-card'], queryFn: () => api.get<{ url: string | null }>('/instagram/end-card').then((r) => r.data) });

  const upload = async (file?: File) => {
    if (!file) return;
    try {
      setProgress(0);
      const { data: start } = await api.post<{ upload_url: string }>('/instagram/end-card', { file_name: file.name, file_size: file.size });
      await uploadToSignedUrl(start.upload_url, file, setProgress);
      toast.success('Fin de vidéo enregistrée : elle sera ajoutée à chaque nouveau reel');
      qc.invalidateQueries({ queryKey: ['end-card'] });
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? e.message ?? 'Envoi impossible');
    } finally {
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };
  const remove = useMutation({
    mutationFn: () => api.delete('/instagram/end-card'),
    onSuccess:  () => { toast.success('Fin de vidéo retirée'); qc.invalidateQueries({ queryKey: ['end-card'] }); },
  });

  return (
    <div className="card p-4 flex flex-wrap items-center gap-4">
      {data?.url
        ? <video src={data.url} className="w-16 aspect-[9/16] rounded-md bg-black object-cover" muted loop autoPlay playsInline />
        : <div className="w-16 aspect-[9/16] rounded-md bg-gray-100 flex items-center justify-center text-[10px] text-gray-400 text-center p-1">Aucune fin</div>}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-gray-900">Fin de vidéo CTA « Commente DEVIS »</p>
        <p className="text-xs text-gray-500">
          {data?.url
            ? 'Ajoutée automatiquement à la fin de chaque nouveau reel (toutes plateformes) et de l\u2019historique envoyé sur YouTube.'
            : 'Déposez votre séquence de fin montée sur CapCut (2 à 4 s, format vertical) : elle sera ajoutée à chaque reel.'}
        </p>
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => inputRef.current?.click()} disabled={progress !== null} className="btn-secondary btn-sm">
          <Upload className="w-3.5 h-3.5" /> {progress !== null ? `Envoi ${progress} %` : data?.url ? 'Remplacer' : 'Déposer la fin'}
        </button>
        {data?.url && (
          <button onClick={() => { if (confirm('Retirer la fin de vidéo ? Les prochains reels n\u2019en auront plus.')) remove.mutate(); }}
            className="p-1.5 rounded-md text-gray-400 hover:text-red-600 hover:bg-red-50" title="Retirer">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
        <input ref={inputRef} type="file" accept="video/mp4,video/quicktime,.mp4,.mov" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
      </div>
    </div>
  );
}
