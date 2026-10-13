'use client';
import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileCheck2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinApi, type LinkedinImportReport } from '@/lib/api';
import { apiError } from './shared';

// Import du CSV livré par Hermès : on vérifie d'abord (rapport sans rien créer), puis on importe

function Report({ r }: { r: LinkedinImportReport }) {
  return (
    <div className="space-y-2 text-sm">
      <p className="text-gray-700">
        {r.total} ligne(s) lue(s) :{' '}
        <span className="font-semibold text-green-700">{r.dry_run ? `${r.importable} importable(s)` : `${r.imported} importée(s)`}</span>,{' '}
        <span className={`font-semibold ${r.rejected.length ? 'text-red-600' : 'text-gray-500'}`}>{r.rejected.length} rejetée(s)</span>
        {r.warnings.length > 0 && <>, {r.warnings.length} avertissement(s)</>}.
      </p>
      {r.rejected.length > 0 && (
        <div className="max-h-56 overflow-y-auto rounded border border-red-100">
          <table className="w-full text-xs">
            <tbody className="divide-y divide-red-50">
              {r.rejected.map((x) => (
                <tr key={`r${x.line}`}><td className="px-2 py-1 text-gray-400 tabular-nums">l. {x.line}</td><td className="px-2 py-1">{x.name}</td><td className="px-2 py-1 text-red-700">{x.reason}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.warnings.length > 0 && (
        <ul className="text-xs text-amber-700 space-y-0.5">
          {r.warnings.map((w, i) => <li key={`w${i}`}>l. {w.line} · {w.name} : {w.warning}</li>)}
        </ul>
      )}
    </div>
  );
}

export default function ImportCard() {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; text: string } | null>(null);
  const [report, setReport] = useState<LinkedinImportReport | null>(null);
  const [enqueue, setEnqueue] = useState(false);

  const run = useMutation({
    mutationFn: (dry_run: boolean) => linkedinApi.importCsv(file!.text, file!.name, { dry_run, enqueue }),
    onSuccess: (r, dry) => {
      setReport(r.data);
      if (!dry) {
        toast.success(`${r.data.imported} lead(s) importé(s)`);
        setFile(null);
        if (input.current) input.current.value = '';
        qc.invalidateQueries({ queryKey: ['linkedin'] });
      }
    },
    onError: (e) => toast.error(apiError(e)),
  });

  const pick = async (f: File | undefined) => {
    if (!f) return;
    const text = await f.text();
    setFile({ name: f.name, text });
    setReport(null);
    run.reset();
    // Vérification immédiate, sans rien créer
    linkedinApi.importCsv(text, f.name, { dry_run: true }).then((r) => setReport(r.data)).catch((e) => toast.error(apiError(e)));
  };

  return (
    <div className="card p-5 space-y-3">
      <div className="flex items-center gap-2">
        <Upload className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Importer les leads d&apos;Hermès (CSV)</p>
      </div>
      <p className="text-xs text-gray-500">
        En-tête attendu : <code className="text-[11px]">prenom,nom,entreprise,poste,secteur,ville,departement,site_web,linkedin,siren,source,date_sourcing</code>.
        Lignes rejetées : prénom, entreprise ou URL LinkedIn manquants, URL invalide, doublon (même URL, même SIREN, ou même entreprise + ville),
        lead déjà au CRM ou entreprise « ne plus contacter ».
      </p>
      <input ref={input} type="file" accept=".csv,text/csv" className="text-sm" onChange={(e) => pick(e.target.files?.[0])} />
      {report && <Report r={report} />}
      {file && report?.dry_run && report.importable > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" className="rounded" checked={enqueue} onChange={(e) => setEnqueue(e.target.checked)} />
            Ajouter directement à la séquence
          </label>
          <button className="btn-primary btn-sm" disabled={run.isPending} onClick={() => run.mutate(false)}>
            <FileCheck2 className="w-3.5 h-3.5" /> Importer {report.importable} lead(s)
          </button>
        </div>
      )}
    </div>
  );
}
