'use client';
import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linkedin, Link2, ImagePlus, Trash2, X, Pencil, Check, ExternalLink, Sparkles, Copy, Gift, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinPostsApi, type LinkedinPost } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

// LinkedIn inbound sur le profil de Lomig : Claude écrit 2 posts par jour (accroche, valeur, « Commente
// MOT et je t'envoie… ») et la ressource promise (page publique /r/<slug>), publiés à l'heure par l'API
// officielle avec un selfie de Lomig. Lomig relit, corrige, retire, envoie la ressource en message privé
// à ceux qui commentent, et laisse un retour que Claude applique aux posts suivants.
const SITE = 'https://payment-flow-crm-delta.vercel.app';

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
    onSuccess: (_d, b) => { toast.success(b.action === 'cancel' ? 'Post retiré' : b.action === 'edit' ? 'Post modifié' : b.action === 'approve' ? 'Post validé : il partira à l\'heure prévue' : b.action === 'unapprove' ? 'Validation retirée' : 'Retour enregistré : Claude en tiendra compte'); setEdit(false); qc.invalidateQueries({ queryKey: ['linkedin-posts'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  const open = p.status === 'scheduled';
  const st = STATE[p.status];
  const link = p.post_urn ? `https://www.linkedin.com/feed/update/${p.post_urn}/` : null;
  return (
    <div className="card p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${st.cls}`}>{open && !p.approved_at ? 'À valider' : st.label} · {fmt(p.published_at ?? p.scheduled_at)}</span>
        {p.kind && <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.kind === 'provoc' ? 'bg-orange-100 text-orange-700' : 'bg-emerald-100 text-emerald-700'}`}>{p.kind === 'provoc' ? '🔥 Provoc' : '💡 Valeur'}</span>}
        {p.topic && <span className="text-xs text-gray-500">{p.topic}</span>}
        {link && <a href={link} target="_blank" rel="noreferrer" className="text-xs text-indigo-600 inline-flex items-center gap-1">Voir sur LinkedIn <ExternalLink className="w-3 h-3" /></a>}
      </div>
      {edit
        ? <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="input text-sm font-sans" />
        : <p className="text-sm text-gray-800 whitespace-pre-wrap">{p.body}</p>}
      {p.photo_url && <img src={p.photo_url} alt="" className="w-full max-w-sm rounded-lg" />}
      {p.resource_slug && (
        <div className="rounded-lg bg-indigo-50 p-3 text-sm flex flex-wrap items-center gap-2">
          <Gift className="w-4 h-4 text-indigo-600" />
          <span className="font-mono text-xs bg-white px-1.5 py-0.5 rounded border">{p.keyword}</span>
          <a href={`/r/${p.resource_slug}`} target="_blank" rel="noreferrer" className="text-indigo-700 font-medium inline-flex items-center gap-1">{p.resource_title} <ExternalLink className="w-3 h-3" /></a>
          <button onClick={() => { navigator.clipboard.writeText(`Hello ! Comme promis, voici ${p.resource_title?.replace(/^./, (c) => c.toLowerCase())} : ${SITE}/r/${p.resource_slug}\n\nDis-moi ce que tu en penses 🙂`); toast.success('Message copié : colle-le en message privé'); }}
            className="ml-auto btn-secondary text-xs inline-flex items-center gap-1"><Copy className="w-3.5 h-3.5" />Copier le message privé</button>
        </div>
      )}
      {p.error && <p className="text-xs text-red-600">{p.error}</p>}
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} placeholder="Ton retour (ton, accroche, offre, longueur…) : Claude l'appliquera aux prochains posts" className="input text-sm" />
      <div className="flex flex-wrap gap-2">
        <button onClick={() => act.mutate({ action: 'feedback', feedback: note })} disabled={act.isPending || !note.trim()} className="btn-secondary text-sm">Envoyer le retour</button>
        {open && !p.approved_at && <button onClick={() => act.mutate({ action: 'approve' })} disabled={act.isPending} className="btn-primary inline-flex items-center gap-1.5 text-sm"><Check className="w-4 h-4" />Valider</button>}
        {open && p.approved_at && <button onClick={() => act.mutate({ action: 'unapprove' })} disabled={act.isPending} className="btn-secondary text-sm">Retirer la validation</button>}
        {open && !edit && <button onClick={() => setEdit(true)} className="btn-secondary inline-flex items-center gap-1.5 text-sm"><Pencil className="w-4 h-4" />Modifier</button>}
        {open && edit && <button onClick={() => act.mutate({ action: 'edit', body, photo_id: p.photo_id })} disabled={act.isPending} className="btn-primary inline-flex items-center gap-1.5 text-sm"><Check className="w-4 h-4" />Enregistrer</button>}
        {open && <button onClick={() => act.mutate({ action: 'cancel', feedback: note })} disabled={act.isPending} className="btn-secondary inline-flex items-center gap-1.5 text-sm text-red-600"><X className="w-4 h-4" />Retirer</button>}
      </div>
    </div>
  );
}

// Selfie recadré en carré (centré, 1 080 × 1 080, JPEG) avant l'envoi : format demandé par Lomig
async function toSquare(f: File): Promise<Blob> {
  const img = await createImageBitmap(f, { imageOrientation: 'from-image' } as any);
  const side = Math.min(img.width, img.height), out = Math.min(1080, side);
  const c = document.createElement('canvas');
  c.width = c.height = out;
  c.getContext('2d')!.drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, out, out);
  return new Promise((ok, ko) => c.toBlob((b) => (b ? ok(b) : ko(new Error(`Photo illisible : ${f.name}`))), 'image/jpeg', 0.9));
}

// CTA du modèle : toujours le même mot, ajouté par le CRM à la fin de chaque post (et des posts non publiés)
function TemplateCta({ settings, example }: { settings: { cta_keyword: string; cta_template: string }; example: string }) {
  const qc = useQueryClient();
  const [word, setWord] = useState(settings.cta_keyword);
  const [tpl, setTpl] = useState(settings.cta_template);
  const save = useMutation({
    mutationFn: () => linkedinPostsApi.action({ action: 'settings', cta_keyword: word, cta_template: tpl }).then((r) => r.data as { updated: number }),
    onSuccess: (d) => { toast.success(`Modèle enregistré${d.updated ? ` : ${d.updated} post${d.updated > 1 ? 's' : ''} à venir mis à jour` : ''}`); qc.invalidateQueries({ queryKey: ['linkedin-posts'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  const preview = tpl.replace(/\{mot\}/g, word.toUpperCase() || 'GO').replace(/\{ressource\}/g, example.replace(/^./, (c) => c.toLowerCase()));
  const changed = word !== settings.cta_keyword || tpl !== settings.cta_template;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block text-xs text-gray-500 mb-1">Mot à commenter (le même pour tous les posts)</span>
          <input value={word} onChange={(e) => setWord(e.target.value.toUpperCase())} className="input w-36 font-mono" maxLength={20} />
        </label>
        <label className="text-sm flex-1 min-w-[280px]">
          <span className="block text-xs text-gray-500 mb-1">Phrase du CTA : {'{mot}'} = le mot, {'{ressource}'} = la ressource du post</span>
          <input value={tpl} onChange={(e) => setTpl(e.target.value)} className="input w-full" maxLength={300} />
        </label>
        <button onClick={() => save.mutate()} disabled={!changed || save.isPending} className="btn-primary text-sm">Enregistrer</button>
      </div>
      <p className="text-sm text-gray-600">Aperçu : <i>{preview}</i></p>
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
    onSuccess: (d) => { toast.success(d.created ? `${d.created} posts écrits` : 'Rien de plus pour l\'instant : 4 posts attendent déjà ta validation'); qc.invalidateQueries({ queryKey: ['linkedin-posts'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    try {
      for (const f of Array.from(files)) {
        const square = await toSquare(f);
        const { data: u } = await linkedinPostsApi.action({ action: 'photo_upload_url', name: 'selfie.jpg' }) as any;
        const form = new FormData();
        form.append('cacheControl', '3600');
        form.append('', square, 'selfie.jpg');
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
        <p className="text-sm text-gray-500 mt-1">10 posts par semaine sur ton profil, du lundi au vendredi : un post 💡 valeur vers 8 h 25 et un post 🔥 provoc vers 12 h 35. Accroche d&apos;une ligne, des raisons ou des points en liste, puis ton CTA, toujours le même mot (réglé dans le modèle ci-dessous). <b>Aucun post ne part sans ta validation</b> : relis, modifie, valide. Claude en prépare 4 à l&apos;avance. Chaque post part avec un de tes selfies, recadré en carré.</p>
      </div>
      {(!c.connected || data.photos.length === 0) && (
        <div className="card p-4 border-amber-300 bg-amber-50 text-sm text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <span>Aucun post ne peut partir tant que {!c.connected ? 'ton profil LinkedIn n\'est pas connecté' : ''}{!c.connected && data.photos.length === 0 ? ' et que ' : ''}{data.photos.length === 0 ? 'tu n\'as pas déposé de selfies (15 à 30 idéalement)' : ''}.</span>
        </div>
      )}

      <div className="card p-4 flex flex-wrap items-center gap-3">
        {c.connected
          ? <p className="text-sm text-gray-700">Connecté : <b>{c.name}</b> · reconnexion avant le {new Date(c.expires_at!).toLocaleDateString('fr-FR')} (règle LinkedIn, rappel par mail)</p>
          : <p className="text-sm text-amber-700">Profil non connecté : aucun post ne peut partir.</p>}
        <button onClick={connect} className={`${c.connected ? 'btn-secondary' : 'btn-primary'} inline-flex items-center gap-1.5 text-sm`}><Link2 className="w-4 h-4" />{c.connected ? 'Reconnecter' : 'Connecter mon profil LinkedIn'}</button>
        <button onClick={() => fill.mutate()} disabled={fill.isPending} className="btn-secondary inline-flex items-center gap-1.5 text-sm ml-auto">{fill.isPending ? <Spinner /> : <Sparkles className="w-4 h-4" />}Écrire les prochains posts</button>
      </div>

      <div className="card p-4 space-y-4">
        <h2 className="font-semibold text-gray-900">Modèle des posts</h2>
        <TemplateCta settings={data.settings} example={upcoming[0]?.resource_title ?? 'ma checklist pour lancer son activité'} />
        <div className="space-y-3 border-t pt-4">
          <div className="flex items-center gap-3">
            <h3 className="font-medium text-gray-900">Tes selfies ({data.photos.length})</h3>
            <p className="text-xs text-gray-500">Recadrés en carré au dépôt. Un par post, le moins utilisé d&apos;abord.</p>
            <input ref={file} type="file" accept="image/*" multiple className="hidden" onChange={(e) => upload(e.target.files)} />
            <button onClick={() => file.current?.click()} disabled={uploading} className="btn-secondary inline-flex items-center gap-1.5 text-sm ml-auto">{uploading ? <Spinner /> : <ImagePlus className="w-4 h-4" />}Ajouter des selfies</button>
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
