'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linkedin, Link2, ImagePlus, Trash2, X, Pencil, Check, ExternalLink, Sparkles } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinPostsApi, type LinkedinPost } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

// Posts LinkedIn automatiques sur le profil de Lomig : Claude écrit 2 à 3 posts par jour (accroche,
// valeur, offre gratuite en commentaire), publiés à l'heure par l'API officielle. Lomig relit, corrige,
// retire et laisse un retour que Claude applique aux posts suivants.

const fmt = (iso: string) => new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const STATE: Record<LinkedinPost['status'], { label: string; cls: string }> = {
  scheduled:  { label: 'Programmé', cls: 'bg-indigo-100 text-indigo-700' },
  publishing: { label: 'Publication…', cls: 'bg-gray-100 text-gray-600' },
  published:  { label: 'Publié', cls: 'bg-emerald-100 text-emerald-700' },
  failed:     { label: 'Échec', cls: 'bg-red-100 text-red-700' },
  cancelled:  { label: 'Retiré', cls: 'bg-gray-100 text-gray-500' },
};

function PostCard({ p }: { p: LinkedinPost }) {
  const qc = useQueryClient();
  const [note, setNote] = useState(p.feedback ?? '');
  const [edit, setEdit] = useState(false);
  const [body, setBody] = useState(p.body);
  const act = useMutation({
    mutationFn: (b: Record<string, unknown>) => linkedinPostsApi.action({ id: p.id, ...b }),
    onSuccess: (_d, b) => { toast.success(b.action === 'cancel' ? 'Post retiré' : b.action === 'edit' ? 'Post modifié' : 'Retour enregistré : Claude en tiendra compte'); setEdit(false); qc.invalidateQueries({ queryKey: ['linkedin-posts'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  const open = p.status === 'scheduled';
  const st = STATE[p.status];
  const link = p.post_urn ? `https://www.linkedin.com/feed/update/${p.post_urn}/` : null;
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{st.label} · {fmt(p.published_at ?? p.scheduled_at)}</span>
        {p.topic && <span className="text-xs text-gray-500">{p.topic}</span>}
        {link && <a href={link} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 inline-flex items-center gap-1">Voir sur LinkedIn <ExternalLink className="w-3 h-3" /></a>}
      </div>
      {edit
        ? <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="input text-sm font-sans" />
        : <p className="text-sm text-gray-800 whitespace-pre-wrap">{p.body}</p>}
      {p.photo_url && <img src={p.photo_url} alt="" className="w-full max-w-sm rounded-lg" />}
      {p.error && <p className="text-xs text-red-600">{p.error}</p>}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ton retour (ton, accroche, offre, longueur…) : Claude l'appliquera aux prochains posts" className="input text-sm" />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => act.mutate({ action: 'feedback', feedback: note })} disabled={act.isPending || !note.trim()} className="btn-secondary text-sm">Envoyer le retour</button>
        {open && !edit && <button onClick={() => setEdit(true)} className="btn-secondary inline-flex items-center gap-1.5 text-sm"><Pencil className="w-4 h-4" />Modifier</button>}
        {open && edit && <button onClick={() => act.mutate({ action: 'edit', body, photo_id: p.photo_id })} disabled={act.isPending} className="btn-primary inline-flex items-center gap-1.5 text-sm"><Check className="w-4 h-4" />Enregistrer</button>}
        {open && <button onClick={() => act.mutate({ action: 'cancel', feedback: note })} disabled={act.isPending} className="btn-secondary inline-flex items-center gap-1.5 text-sm text-red-600"><X className="w-4 h-4" />Retirer</button>}
      </div>
    </div>
  );
}

export default function LinkedinPostsPage() {
  const qc = useQueryClient();
  const file = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const { data, isLoading } = useQuery({ queryKey: ['linkedin-posts'], queryFn: () => linkedinPostsApi.list().then((r) => r.data), refetchInterval: 60_000 });

  // Retour de LinkedIn après la connexion
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    if (q.get('connected')) toast.success('Profil LinkedIn connecté');
    if (q.get('linkedin_error')) toast.error(`Connexion LinkedIn : ${q.get('linkedin_error')}`);
    if (q.get('connected') || q.get('linkedin_error')) window.history.replaceState(null, '', '/linkedin/posts');
  }, []);

  const connect = async () => { const { data: d } = await linkedinPostsApi.connectUrl(); window.location.href = d.url; };
  const fill = useMutation({
    mutationFn: () => linkedinPostsApi.action({ action: 'fill' }).then((r) => r.data as { created: number }),
    onSuccess: (d) => { toast.success(d.created ? `${d.created} posts écrits` : 'Le planning des 7 prochains jours est déjà plein'); qc.invalidateQueries({ queryKey: ['linkedin-posts'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const { data: u } = await linkedinPostsApi.action({ action: 'photo_upload_url', name: f.name }) as any;
        const form = new FormData();
        form.append('cacheControl', '3600');
        form.append('', f, f.name);
        const r = await fetch(u.signed_url, { method: 'PUT', body: form });
        if (!r.ok) throw new Error(`Envoi de ${f.name} : HTTP ${r.status}`);
        await linkedinPostsApi.action({ action: 'photo_add', path: u.path, label: f.name });
      }
      toast.success('Photos ajoutées');
      qc.invalidateQueries({ queryKey: ['linkedin-posts'] });
    } catch (e: any) { toast.error(e.message); } finally { setUploading(false); if (file.current) file.current.value = ''; }
  };
  const delPhoto = useMutation({
    mutationFn: (id: string) => linkedinPostsApi.action({ action: 'photo_delete', id }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['linkedin-posts'] }),
  });

  if (isLoading || !data) return <div className="flex justify-center py-20"><Spinner /></div>;
  const c = data.connection;
  const upcoming = data.posts.filter((p) => p.status === 'scheduled' || p.status === 'publishing');
  const past = data.posts.filter((p) => p.status !== 'scheduled' && p.status !== 'publishing').reverse();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Linkedin className="w-6 h-6 text-[#0a66c2]" />Posts LinkedIn automatiques</h1>
        <p className="text-sm text-gray-500 mt-1">Claude écrit 3 posts par jour en semaine et 2 le week-end, sur ton profil : une accroche, de la valeur, une offre gratuite à demander en commentaire. Ils partent à l&apos;heure via l&apos;API officielle de LinkedIn. Tu peux les modifier ou les retirer avant publication, et ton retour est appliqué aux suivants.</p>
      </div>

      <div className="card p-4 flex flex-wrap items-center gap-3">
        {c.connected
          ? <p className="text-sm text-gray-700">Connecté : <b>{c.name}</b> · reconnexion avant le {new Date(c.expires_at!).toLocaleDateString('fr-FR')} (règle LinkedIn, rappel par mail)</p>
          : <p className="text-sm text-amber-700">Profil non connecté : aucun post ne peut partir.</p>}
        <button onClick={connect} className={`${c.connected ? 'btn-secondary' : 'btn-primary'} inline-flex items-center gap-1.5 text-sm`}><Link2 className="w-4 h-4" />{c.connected ? 'Reconnecter' : 'Connecter mon profil LinkedIn'}</button>
        <button onClick={() => fill.mutate()} disabled={fill.isPending} className="btn-secondary inline-flex items-center gap-1.5 text-sm ml-auto">{fill.isPending ? <Spinner /> : <Sparkles className="w-4 h-4" />}Écrire les prochains posts</button>
      </div>

      <div className="card p-4 space-y-3">
        <div className="flex items-center gap-3">
          <h2 className="font-semibold text-gray-900">Photos ({data.photos.length})</h2>
          <p className="text-xs text-gray-500">Réutilisées par les posts, la moins utilisée d&apos;abord.</p>
          <input ref={file} type="file" accept="image/jpeg,image/png" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
          <button onClick={() => file.current?.click()} disabled={uploading} className="btn-secondary inline-flex items-center gap-1.5 text-sm ml-auto">{uploading ? <Spinner /> : <ImagePlus className="w-4 h-4" />}Ajouter des photos</button>
        </div>
        {data.photos.length > 0 && (
          <div className="flex flex-wrap gap-3">
            {data.photos.map((ph) => (
              <div key={ph.id} className="relative group">
                <img src={ph.url} alt="" className="w-28 h-28 object-cover rounded-lg" />
                <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 text-white px-1.5 rounded">{ph.uses} post{ph.uses > 1 ? 's' : ''}</span>
                <button onClick={() => delPhoto.mutate(ph.id)} className="absolute top-1 right-1 p-1 rounded bg-white/90 text-red-600 opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div>
        <h2 className="font-semibold text-gray-900 mb-3">À venir ({upcoming.length})</h2>
        {upcoming.length === 0
          ? <p className="text-sm text-gray-500">Aucun post programmé pour l&apos;instant.</p>
          : <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{upcoming.map((p) => <PostCard key={p.id} p={p} />)}</div>}
      </div>
      {past.length > 0 && (
        <div>
          <h2 className="font-semibold text-gray-900 mb-3">Récents</h2>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">{past.map((p) => <PostCard key={p.id} p={p} />)}</div>
        </div>
      )}
    </div>
  );
}
