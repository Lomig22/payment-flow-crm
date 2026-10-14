'use client';
import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Upload, Search } from 'lucide-react';
import toast from 'react-hot-toast';
import { emailingApi } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

// Leads emailing : import du fichier CSV (colonnes reconnues : email, prénom, nom, entreprise,
// poste, secteur, ville, téléphone, site, linkedin ; les autres sont gardées et transmises à
// Hermès pour la personnalisation) et suivi de chaque lead dans la séquence.

const STATUS: Record<string, { label: string; cls: string }> = {
  new: { label: 'À contacter', cls: 'bg-gray-100 text-gray-700' }, in_sequence: { label: 'En séquence', cls: 'bg-indigo-100 text-indigo-700' },
  replied: { label: 'A répondu', cls: 'bg-emerald-100 text-emerald-700' }, interested: { label: 'Intéressé', cls: 'bg-emerald-200 text-emerald-800' },
  not_interested: { label: 'Pas intéressé', cls: 'bg-orange-100 text-orange-700' }, bounced: { label: 'Adresse invalide', cls: 'bg-red-100 text-red-700' },
  unsubscribed: { label: 'Désinscrit', cls: 'bg-red-100 text-red-700' }, dnc: { label: 'Ne pas contacter', cls: 'bg-red-100 text-red-700' },
  completed: { label: 'Séquence terminée', cls: 'bg-gray-100 text-gray-500' },
};
const d = (iso: string | null) => (iso ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—');

function EmailLeads() {
  const qc = useQueryClient();
  const sp = useSearchParams();
  const [status, setStatus] = useState(sp.get('status') ?? '');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { data, isLoading } = useQuery({
    queryKey: ['email-leads', status, q, page],
    queryFn: () => emailingApi.leads({ status: status || undefined, q: q || undefined, page }).then((r) => r.data),
  });

  const onFile = async (f: File) => {
    setBusy(true);
    try {
      const r = (await emailingApi.import(await f.text(), f.name)).data;
      toast.success(`${r.inserted} leads ajoutés · ${r.duplicates} doublons · ${r.invalid} adresses invalides${r.dnc ? ` · ${r.dnc} « ne pas contacter »` : ''}`, { duration: 8000 });
      if (r.errors.length) toast.error(r.errors[0]);
      qc.invalidateQueries({ queryKey: ['email-leads'] });
    } catch (e: any) {
      toast.error(e?.response?.data?.message ?? 'Import impossible');
    } finally {
      setBusy(false);
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Emailing · Leads</h1>
          <p className="text-sm text-gray-500 mt-1">{data ? `${data.total.toLocaleString('fr-FR')} leads` : ''}</p>
        </div>
        <div>
          <input ref={file} type="file" accept=".csv,text/csv" className="hidden" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} />
          <button className="btn-primary inline-flex items-center gap-2 text-sm" disabled={busy} onClick={() => file.current?.click()}>
            {busy ? <Spinner /> : <Upload className="w-4 h-4" />}Importer un CSV
          </button>
        </div>
      </div>

      <div className="flex gap-3 flex-wrap">
        <div className="relative"><Search className="w-4 h-4 absolute left-3 top-2.5 text-gray-400" />
          <input className="input pl-9 w-72" placeholder="Email, entreprise, nom…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} /></div>
        <select className="input w-56" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">Tous les statuts</option>
          {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {isLoading || !data ? <div className="flex justify-center py-20"><Spinner /></div> : (
        <div className="card overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-gray-500 border-b"><tr>
              <th className="p-3">Lead</th><th className="p-3">Entreprise</th><th className="p-3">Statut</th><th className="p-3">Mail</th><th className="p-3">Dernier envoi</th><th className="p-3">Prochain</th><th className="p-3">Boîte</th>
            </tr></thead>
            <tbody>
              {data.leads.map((l) => (
                <tr key={l.id} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="p-3"><p className="font-medium text-gray-900">{[l.first_name, l.last_name].filter(Boolean).join(' ') || '—'}</p><p className="text-xs text-gray-500">{l.email}</p></td>
                  <td className="p-3"><p>{l.company ?? '—'}</p><p className="text-xs text-gray-500">{[l.sector, l.city].filter(Boolean).join(' · ')}</p></td>
                  <td className="p-3"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[l.status]?.cls ?? ''}`}>{STATUS[l.status]?.label ?? l.status}</span></td>
                  <td className="p-3">{l.step || '—'}</td>
                  <td className="p-3 text-xs">{d(l.last_sent_at)}</td>
                  <td className="p-3 text-xs">{l.status === 'in_sequence' ? d(l.next_send_at) : '—'}</td>
                  <td className="p-3 text-xs text-gray-500">{l.mailbox ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="flex justify-between items-center p-3 text-sm text-gray-500">
            <span>Page {data.page} / {Math.max(1, Math.ceil(data.total / data.size))}</span>
            <div className="flex gap-2">
              <button className="btn-secondary text-sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>Précédent</button>
              <button className="btn-secondary text-sm" disabled={page * data.size >= data.total} onClick={() => setPage(page + 1)}>Suivant</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// useSearchParams exige une frontière Suspense (Next 14)
export default function EmailLeadsPage() {
  return <Suspense fallback={<div className="flex justify-center py-20"><Spinner /></div>}><EmailLeads /></Suspense>;
}
