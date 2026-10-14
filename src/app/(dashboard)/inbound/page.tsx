'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Inbox, Instagram, Facebook, MessageCircle, UserPlus, Mail, CheckCheck, EyeOff, ExternalLink, AlertTriangle, CheckCircle2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { inboundSheetApi, type InboundItem, type InboundSheet } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Spinner from '@/components/ui/Spinner';

// Feuille Inbound : toutes les personnes qui interagissent avec les contenus (commentaires
// Instagram et Facebook, abonnements, DM), avec le mot-clé du reel, le jugement d'intérêt et le lead.

const KIND: Record<InboundItem['kind'], { label: string; icon: React.ElementType }> = {
  comment: { label: 'Commentaire', icon: MessageCircle }, follow: { label: 'Abonnement', icon: UserPlus },
  dm: { label: 'DM', icon: Mail }, story_reply: { label: 'Réponse à une story', icon: Mail },
};
const INTENT: Record<string, { label: string; cls: string }> = {
  keyword:  { label: 'Mot-clé',  cls: 'bg-emerald-100 text-emerald-800' },
  interest: { label: 'Intérêt',  cls: 'bg-sky-100 text-sky-800' },
  other:    { label: 'Autre',    cls: 'bg-gray-100 text-gray-600' },
};
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');
const apiError = (e: any) => e?.response?.data?.message ?? 'Erreur';
const DAY = 86_400_000;

function CaptureStatus({ s }: { s: InboundSheet['settings'] }) {
  const row = (name: string, Icon: React.ElementType, at: string | null, err: string | null, fix: React.ReactNode) => (
    <div className="flex gap-3 py-2">
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0 text-gray-500" />
      <div className="text-sm">
        <p className="font-medium text-gray-900 flex items-center gap-2">
          {name}
          {err ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">captation incomplète</span>
            : at ? <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">active</span>
            : <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">pas encore lancée</span>}
          <span className="text-xs font-normal text-gray-400">dernière lecture {fmt(at)}</span>
        </p>
        {err && <p className="text-xs text-amber-800 mt-0.5">{err}</p>}
        {err && <div className="text-xs text-gray-600 mt-1">{fix}</div>}
      </div>
    </div>
  );
  return (
    <div className="card p-5">
      <p className="text-sm font-semibold text-gray-900 mb-1">Captation</p>
      <div className="divide-y divide-gray-50">
        {row('Commentaires Instagram', Instagram, s?.ig_last_sync_at ?? null, s?.ig_last_error ?? null,
          <>Meta ne montre les commentaires de tes prospects qu&apos;une fois l&apos;application validée (« App Review » : autorisations
            instagram_business_manage_comments et instagram_business_manage_messages). Tant que ce n&apos;est pas fait, seuls les comptes de l&apos;équipe sont visibles.</>)}
        {row('Commentaires Facebook', Facebook, s?.fb_last_sync_at ?? null, s?.fb_last_error ?? null,
          <>La connexion de la Page doit être refaite avec les autorisations pages_read_engagement et pages_read_user_content
            (Explorateur de l&apos;API Graph → nouveau jeton → script facebook-page-token), puis validée par Meta pour lire les commentaires de tous.</>)}
        {row('Abonnés Instagram', UserPlus, null, null, null)}
      </div>
      <p className="text-[11px] text-gray-400 mt-1">
        Abonnés : Meta ne donne que leur nombre. La liste (qui s&apos;est abonné) vient de l&apos;export officiel Instagram, à importer dans Instagram → Leads → Importer les abonnés.
        Les likes ne sont exposés par aucune API (seulement leur nombre).
      </p>
    </div>
  );
}

export default function InboundPage() {
  const qc = useQueryClient();
  const isAdmin = useAuthStore((st) => st.user?.role === 'admin');
  const [platform, setPlatform] = useState<'all' | 'instagram' | 'facebook'>('all');
  const [kind, setKind] = useState<'all' | InboundItem['kind']>('all');
  const [view, setView] = useState<'todo' | 'all' | 'other'>('todo');
  const { data, isLoading, error } = useQuery({ queryKey: ['inbound'], queryFn: () => inboundSheetApi.overview().then((r) => r.data), refetchInterval: 60_000, enabled: isAdmin });
  const refresh = () => qc.invalidateQueries({ queryKey: ['inbound'] });
  const setStatus = useMutation({ mutationFn: ({ a, ids }: { a: 'handled' | 'ignored' | 'new'; ids: string[] }) => inboundSheetApi.setStatus(a, ids), onSuccess: refresh, onError: (e) => toast.error(apiError(e)) });
  const createLead = useMutation({ mutationFn: (id: string) => inboundSheetApi.createLead(id), onSuccess: () => { toast.success('Lead créé'); refresh(); }, onError: (e) => toast.error(apiError(e)) });

  const items = data?.items ?? [];
  const stats = useMemo(() => {
    const week = items.filter((i) => i.occurred_at && Date.now() - new Date(i.occurred_at).getTime() < 7 * DAY);
    return {
      comments: week.filter((i) => i.kind === 'comment').length,
      hot: week.filter((i) => i.intent === 'keyword' || i.intent === 'interest').length,
      follows: week.filter((i) => i.kind === 'follow').length,
      dms: week.filter((i) => i.kind === 'dm' || i.kind === 'story_reply').length,
      todo: items.filter((i) => i.status === 'new' && i.intent !== 'other').length,
    };
  }, [items]);
  const shown = items.filter((i) => (platform === 'all' || i.platform === platform) && (kind === 'all' || i.kind === kind)
    && (view === 'all' || (view === 'todo' ? i.status === 'new' && i.intent !== 'other' : i.intent === 'other')));
  const gained7 = (data?.followers ?? []).slice(-7).reduce((a, d) => a + Math.max(0, d.gained), 0);

  if (!isAdmin) return <p className="text-sm text-gray-500">Page réservée aux administrateurs.</p>;
  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (error || !data) return <p className="text-sm text-red-600">{apiError(error)}</p>;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Inbox className="w-6 h-6 text-emerald-600" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">Inbound</h1>
          <p className="text-sm text-gray-500">
            Tous ceux qui interagissent avec tes contenus. Un commentaire avec le mot-clé du reel ({data.settings?.keywords?.join(', ')}, ou celui de la légende)
            ou qui montre un intérêt devient un lead, et tu reçois un e-mail.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[
          ['À traiter', stats.todo], ['Commentaires (7 j)', stats.comments], ['Mot-clé ou intérêt (7 j)', stats.hot],
          ['Abonnés gagnés (7 j)', gained7], ['DM entrants (7 j)', stats.dms],
        ].map(([l, v]) => (
          <div key={String(l)} className="card p-4"><p className="text-xs text-gray-500">{l}</p><p className="text-2xl font-bold text-gray-900 tabular-nums">{v}</p></div>
        ))}
      </div>

      <CaptureStatus s={data.settings} />

      {(data.followers ?? []).length > 1 && (
        <div className="card p-5">
          <p className="text-sm font-semibold text-gray-900 mb-2">Abonnés Instagram gagnés par jour</p>
          <div className="flex items-end gap-1 h-24">
            {data.followers.map((d) => {
              const max = Math.max(1, ...data.followers.map((x) => Math.abs(x.gained)));
              return (
                <div key={d.day} className="flex-1 flex flex-col items-center justify-end h-full" title={`${d.day} : ${d.gained >= 0 ? '+' : ''}${d.gained} (${d.total})`}>
                  <div className={`w-full rounded-t ${d.gained >= 0 ? 'bg-emerald-500' : 'bg-red-300'}`} style={{ height: `${(Math.abs(d.gained) / max) * 100}%`, minHeight: 2 }} />
                </div>
              );
            })}
          </div>
          <p className="text-[11px] text-gray-400 mt-1">Total actuel : {data.followers[data.followers.length - 1]?.total} abonnés.</p>
        </div>
      )}

      <div className="card p-5 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          {(['todo', 'all', 'other'] as const).map((v) => (
            <button key={v} onClick={() => setView(v)} className={`text-xs px-2.5 py-1 rounded-full ${view === v ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>
              {v === 'todo' ? `À traiter (${stats.todo})` : v === 'all' ? 'Tout' : 'Sans intérêt détecté'}
            </button>
          ))}
          <select className="input py-1 text-sm w-auto ml-auto" value={platform} onChange={(e) => setPlatform(e.target.value as any)}>
            <option value="all">Instagram et Facebook</option><option value="instagram">Instagram</option><option value="facebook">Facebook</option>
          </select>
          <select className="input py-1 text-sm w-auto" value={kind} onChange={(e) => setKind(e.target.value as any)}>
            <option value="all">Toutes les interactions</option><option value="comment">Commentaires</option><option value="follow">Abonnements</option><option value="dm">DM</option>
          </select>
        </div>

        {shown.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">
            {items.length === 0 ? 'Aucune interaction captée pour l\'instant : voir l\'état de la captation ci-dessus.' : 'Rien dans cette vue.'}
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {shown.slice(0, 300).map((i) => {
              const K = KIND[i.kind];
              const P = i.platform === 'facebook' ? Facebook : Instagram;
              return (
                <div key={i.id} className={`py-3 flex flex-wrap gap-3 items-start ${i.status !== 'new' ? 'opacity-60' : ''}`}>
                  <div className="flex items-center gap-1.5 w-28 flex-shrink-0 text-xs text-gray-500">
                    <P className={`w-3.5 h-3.5 ${i.platform === 'facebook' ? 'text-blue-600' : 'text-pink-500'}`} />
                    <K.icon className="w-3.5 h-3.5" /> {fmt(i.occurred_at)}
                  </div>
                  <div className="flex-1 min-w-[240px] text-sm">
                    <p>
                      <span className="font-medium text-gray-900">{i.author_name ?? i.author_handle ?? 'Auteur masqué par Meta'}</span>
                      {i.author_handle && i.author_handle !== i.author_name && <span className="text-gray-500"> @{i.author_handle}</span>}
                      <span className="text-gray-400"> · {K.label}</span>
                      {i.intent && <span className={`ml-2 text-[11px] px-1.5 py-0.5 rounded ${INTENT[i.intent].cls}`}>{INTENT[i.intent].label}{i.keyword ? ` ${i.keyword}` : ''}</span>}
                    </p>
                    {i.text && <p className="text-gray-800 mt-0.5 whitespace-pre-wrap">« {i.text} »</p>}
                    <p className="text-xs text-gray-400 mt-0.5">
                      {i.content_caption && <>sous « {i.content_caption.split('\n')[0].slice(0, 80)} »</>}
                      {i.intent_reason && i.intent === 'interest' && <> · {i.intent_reason}</>}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2 items-center">
                    {i.permalink && <a className="text-xs text-[#0a66c2] inline-flex items-center gap-1 hover:underline" href={i.permalink} target="_blank" rel="noreferrer">Voir <ExternalLink className="w-3 h-3" /></a>}
                    {i.lead_id
                      ? <Link href={`/leads/${i.lead_id}`} className="text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:underline">Lead {i.leads ? `${i.leads.first_name} ${i.leads.last_name === '—' ? '' : i.leads.last_name}` : ''}</Link>
                      : <button className="btn-secondary btn-sm" disabled={createLead.isPending || (!i.author_handle && !i.author_name)} onClick={() => createLead.mutate(i.id)}>Créer le lead</button>}
                    {i.status === 'new'
                      ? <>
                          <button className="btn-secondary btn-sm" onClick={() => setStatus.mutate({ a: 'handled', ids: [i.id] })}><CheckCheck className="w-3.5 h-3.5" /> Traité</button>
                          <button className="btn-secondary btn-sm" onClick={() => setStatus.mutate({ a: 'ignored', ids: [i.id] })}><EyeOff className="w-3.5 h-3.5" /> Ignorer</button>
                        </>
                      : <button className="text-xs text-gray-500 hover:underline" onClick={() => setStatus.mutate({ a: 'new', ids: [i.id] })}>Rouvrir</button>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-400 flex items-center gap-1.5">
        {data.settings?.auto_reply_text ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
        DM automatique en réponse à un commentaire avec mot-clé : {data.settings?.auto_reply_text ? 'actif' : 'désactivé (aucun texte de réponse)'}.
      </p>
    </div>
  );
}
