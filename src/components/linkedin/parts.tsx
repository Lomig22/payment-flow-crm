'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linkedin, MessageSquareReply, Ban, CheckCheck, UserPlus, FlaskConical, ExternalLink, Eye, EyeOff, Copy } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinApi, type LinkedinLead, type LinkedinSettings, type LinkedinOverview } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Spinner from '@/components/ui/Spinner';
import { SECTORS, STAGE_LABELS } from '@/lib/linkedinLabels';
import { fmtTime, fullName, apiError } from './shared';

// Blocs de la section LinkedIn partagés par ses sous-pages (opérationnel et organisation)

const ACTION_LABEL: Record<string, string> = {
  invite: 'Invitation', dm: 'Premier message', followup: 'Relance', scan: 'Lecture des relations', inbox: 'Messagerie',
  profile: 'Visite du profil', posts: 'Publications', withdraw: 'Retrait d\'invitation', session: 'Session LinkedIn',
};
const RESULT_LABEL: Record<string, string> = {
  ok: 'OK', pending: 'déjà en attente', already_connected: 'déjà en relation', not_pending: 'plus en attente',
  existing_thread: 'conversation existante', not_connected: 'pas en relation', error: 'erreur', replied: 'a répondu',
  auth: 'déconnexion / vérification', limit: 'limite atteinte', warning: 'avertissement LinkedIn',
};

export function useLeadsAction() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ action, ids }: { action: 'enqueue' | 'requeue' | 'remove' | 'preview' | 'handled'; ids: string[] }) => linkedinApi.leadsAction(action, ids),
    onSuccess: (r, { action }) => {
      const d = r.data as Record<string, number>;
      toast.success({
        enqueue: `${d.enqueued} lead(s) ajouté(s) à la séquence${d.skipped ? ` (${d.skipped} ignoré(s) : déjà en cours, même entreprise ou URL invalide)` : ''}`,
        requeue: `${d.requeued} lead(s) remis dans la séquence`,
        remove: 'Retiré(s) de la séquence',
        preview: `${d.previewing} profil(s) en test : messages rédigés sans envoi, dans « À valider »`,
        handled: 'Marqué(s) comme traité(s)',
      }[action]);
      qc.invalidateQueries({ queryKey: ['linkedin'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
}

export function DncButton({ id, small }: { id: string; small?: boolean }) {
  const qc = useQueryClient();
  const dnc = useMutation({
    mutationFn: () => linkedinApi.doNotContact(id),
    onSuccess: (r) => { toast.success(`Exclu définitivement (${r.data.excluded} lead(s) de l'entreprise)`); qc.invalidateQueries({ queryKey: ['linkedin'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  return (
    <button className={`btn-secondary ${small ? 'btn-xs px-2 py-1 text-xs' : 'btn-sm'} text-red-600`} disabled={dnc.isPending}
      onClick={() => window.confirm('Ne plus contacter ce lead ni son entreprise, définitivement ?') && dnc.mutate()}>
      <Ban className="w-3.5 h-3.5" /> Ne plus contacter
    </button>
  );
}

// Réponses : la séquence est arrêtée pour ces leads, Lomig reprend la main
export function ToResume({ leads }: { leads: LinkedinLead[] }) {
  const act = useLeadsAction();
  const items = leads.filter((l) => l.li_status === 'to_resume').sort((a, b) => String(b.li_replied_at).localeCompare(String(a.li_replied_at)));
  const untreated = items.filter((l) => !l.li_handled_at);
  if (!items.length) return null;
  return (
    <div className="card p-5 space-y-3 border-emerald-200">
      <div className="flex items-center gap-2">
        <MessageSquareReply className="w-4 h-4 text-emerald-600" />
        <p className="text-sm font-semibold text-gray-900">À reprendre ({untreated.length} non traité{untreated.length > 1 ? 's' : ''})</p>
        <span className="text-xs text-gray-500">Ces leads ont répondu : plus aucun message automatique, la conversation est pour vous.</span>
      </div>
      <div className="divide-y divide-gray-100">
        {items.slice(0, 30).map((l) => (
          <div key={l.id} className={`py-3 flex flex-wrap items-start gap-3 ${l.li_handled_at ? 'opacity-50' : ''}`}>
            <div className="flex-1 min-w-[240px]">
              <p className="text-sm">
                <Link href={`/leads/${l.id}`} className="font-semibold text-gray-900 hover:underline">{fullName(l)}</Link>
                <span className="text-gray-500"> · {l.company}</span>
                <span className="text-xs text-gray-400"> · {fmtTime(l.li_replied_at)}{l.li_replied_stage && ` · après ${STAGE_LABELS[l.li_replied_stage]}`}</span>
              </p>
              {l.li_reply_text && <p className="mt-1 text-sm text-gray-700 whitespace-pre-wrap">« {l.li_reply_text} »</p>}
            </div>
            <div className="flex flex-wrap gap-2">
              {(l.li_thread_url || l.linkedin_url) && (
                <a className="btn-secondary btn-sm" href={l.li_thread_url || l.linkedin_url!} target="_blank" rel="noreferrer">
                  <ExternalLink className="w-3.5 h-3.5" /> {l.li_thread_url ? 'Conversation' : 'Profil'}
                </a>
              )}
              {!l.li_handled_at && (
                <button className="btn-secondary btn-sm" disabled={act.isPending} onClick={() => act.mutate({ action: 'handled', ids: [l.id] })}>
                  <CheckCheck className="w-3.5 h-3.5" /> Traité
                </button>
              )}
              <DncButton id={l.id} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function Candidates({ candidates }: { candidates: { id: string; first_name: string | null; last_name: string | null; company: string | null; job_title: string | null; li_sector: string | null; linkedin_url: string | null }[] }) {
  const act = useLeadsAction();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [sector, setSector] = useState('all');
  const shown = candidates.filter((c) => sector === 'all' || c.li_sector === sector);
  const ids = Array.from(selected);
  return (
    <div className="card p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900">Importés, hors séquence ({candidates.length})</p>
        <select className="input py-1 text-sm w-auto" value={sector} onChange={(e) => setSector(e.target.value)}>
          <option value="all">Tous les secteurs</option>
          {Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <div className="ml-auto flex flex-wrap gap-2">
          <button className="btn-secondary btn-sm" disabled={!ids.length || ids.length > 15 || act.isPending}
            title="Visite le profil et rédige le message, sans rien envoyer (15 max)"
            onClick={() => { act.mutate({ action: 'preview', ids }); setSelected(new Set()); }}>
            <FlaskConical className="w-3.5 h-3.5" /> Tester les messages{ids.length ? ` (${ids.length})` : ''}
          </button>
          <button className="btn-primary btn-sm" disabled={!ids.length || act.isPending}
            onClick={() => { act.mutate({ action: 'enqueue', ids }); setSelected(new Set()); }}>
            <UserPlus className="w-3.5 h-3.5" /> Ajouter à la séquence{ids.length ? ` (${ids.length})` : ''}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-400 sticky top-0 bg-white">
            <tr>
              <th className="py-2 pr-2 w-6"><input type="checkbox" className="rounded" checked={shown.length > 0 && shown.every((l) => selected.has(l.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(shown.map((l) => l.id)) : new Set())} /></th>
              <th className="py-2 pr-3 text-left font-medium">Lead</th>
              <th className="py-2 pr-3 text-left font-medium">Secteur</th>
              <th className="py-2 text-left font-medium" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {shown.slice(0, 500).map((l) => (
              <tr key={l.id}>
                <td className="py-2 pr-2"><input type="checkbox" className="rounded" checked={selected.has(l.id)}
                  onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(l.id) : n.delete(l.id); setSelected(n); }} /></td>
                <td className="py-2 pr-3">
                  <Link href={`/leads/${l.id}`} className="font-medium text-gray-900 hover:underline">{fullName(l)}</Link>
                  <span className="block text-xs text-gray-500">{[l.job_title, l.company].filter(Boolean).join(' · ')}</span>
                </td>
                <td className="py-2 pr-3 text-xs text-gray-600">{l.li_sector ? SECTORS[l.li_sector] : '—'}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <button className="text-xs text-[#0a66c2] hover:underline mr-3" onClick={() => act.mutate({ action: 'enqueue', ids: [l.id] })}>Ajouter</button>
                  {l.linkedin_url && <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="text-gray-400 hover:text-[#0a66c2]"><ExternalLink className="w-3.5 h-3.5 inline" /></a>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function WorkerKey({ settings }: { settings: LinkedinSettings }) {
  const [show, setShow] = useState(false);
  const copy = () => navigator.clipboard.writeText(settings.ext_key).then(() => toast.success('Clé copiée'));
  return (
    <div className="card p-5 space-y-2 text-sm">
      <p className="font-semibold text-gray-900">Worker du VPS</p>
      <p className="text-xs text-gray-500">
        Le worker (<code>scripts/linkedin-worker</code>) tourne en continu sur le VPS, avec la session LinkedIn ouverte dans son
        propre navigateur. Il est le seul à utiliser cette session : Hermès source les leads mais ne se connecte jamais à LinkedIn.
      </p>
      <div className="flex gap-2">
        <input readOnly className="input py-1.5 font-mono text-xs" type={show ? 'text' : 'password'} value={settings.ext_key} />
        <button className="btn-secondary btn-sm" onClick={() => setShow(!show)}>{show ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}</button>
        <button className="btn-secondary btn-sm" onClick={copy}><Copy className="w-3.5 h-3.5" /></button>
      </div>
    </div>
  );
}


export function Journal({ log }: { log: LinkedinOverview['log'] }) {
  return (
    <div className="card p-5 space-y-2">
      <p className="text-sm font-semibold text-gray-900">Journal du robot</p>
      <div className="divide-y divide-gray-50 text-sm">
        {log.map((r) => (
          <div key={r.id} className="py-1.5 flex flex-wrap gap-x-3 text-xs">
            <span className="text-gray-400 w-28 tabular-nums">{fmtTime(r.created_at)}</span>
            <span className="w-36 text-gray-700">{ACTION_LABEL[r.action] ?? r.action}{r.stage && r.action === 'followup' ? ` (${STAGE_LABELS[r.stage] ?? r.stage})` : ''}</span>
            <span className={`w-36 ${r.result === 'ok' ? 'text-green-700' : ['auth', 'limit', 'warning', 'error'].includes(r.result) ? 'text-red-600' : 'text-gray-600'}`}>{RESULT_LABEL[r.result] ?? r.result}</span>
            <span className="text-gray-600">{r.leads ? fullName(r.leads) : ''}</span>
            {r.detail && <span className="text-gray-400">{r.detail}</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// Données de la page LinkedIn, partagées par toutes ses sous-pages (même requête, mise en cache)
export function useLinkedin() {
  const isAdmin = useAuthStore((st) => st.user?.role === 'admin');
  const q = useQuery({
    queryKey: ['linkedin'],
    queryFn:  () => linkedinApi.overview().then((r) => r.data),
    refetchInterval: 60_000,
    enabled: isAdmin,
  });
  return { isAdmin, ...q };
}

// Cadre commun des sous-pages : titre, accès admin, chargement
export function LinkedinShell({ title, subtitle, children }: { title: string; subtitle?: string; children: (d: LinkedinOverview) => React.ReactNode }) {
  const { isAdmin, data, isLoading, error } = useLinkedin();
  if (!isAdmin) return <p className="text-sm text-gray-500">Page réservée aux administrateurs.</p>;
  if (isLoading) return <div className="flex justify-center py-20"><Spinner /></div>;
  if (error || !data) return <p className="text-sm text-red-600">{apiError(error)}</p>;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Linkedin className="w-6 h-6 text-[#0a66c2]" />
        <div>
          <h1 className="text-xl font-bold text-gray-900">LinkedIn · {title}</h1>
          {subtitle && <p className="text-sm text-gray-500">{subtitle}</p>}
        </div>
        <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${data.execution.state === 'active' ? 'bg-green-100 text-green-700' : data.execution.state === 'stopped' ? 'bg-red-100 text-red-700' : data.execution.state === 'cooldown' ? 'bg-orange-100 text-orange-800' : 'bg-gray-100 text-gray-600'}`}>
          {data.execution.state === 'active' ? 'Séquence active' : data.execution.state === 'stopped' ? 'Compte BLOQUÉ' : data.execution.state === 'cooldown' ? 'COOLDOWN' : data.execution.state === 'outside' ? 'Hors fenêtre' : 'Séquence en pause'}
        </span>
      </div>
      {children(data)}
    </div>
  );
}
