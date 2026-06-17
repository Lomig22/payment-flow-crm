'use client';
import { useState, useCallback, useEffect } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle, AlertCircle, AlertTriangle, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Spinner from '@/components/ui/Spinner';

interface ImportResult {
  total:            number;
  imported:         number;
  skipped:          number;
  duplicate_count:  number;
  assignment_mode:  string;
  errors?:          string[];
  duplicates?:      string[];
  message:          string;
}

interface DryRunResult {
  dry_run:          true;
  total:            number;
  duplicate_count:  number;
  errors:           string[];
  duplicates:       string[];
}

export default function ImportPage() {
  const user = useAuthStore((s) => s.user);
  const qc   = useQueryClient();
  const isAdmin = user?.role === 'admin';

  const [file,        setFile]        = useState<File | null>(null);
  const [mode,        setMode]        = useState<'round_robin' | 'manual'>('round_robin');
  const [setterId,    setSetterId]    = useState('');
  const [rrSetterIds, setRrSetterIds] = useState<string[]>([]);
  const [source,      setSource]      = useState<string>('cold_call');
  const [batchNiche,  setBatchNiche]  = useState('');
  const [result,      setResult]      = useState<ImportResult | null>(null);
  const [pendingPreview, setPendingPreview] = useState<DryRunResult | null>(null);

  const NICHE_OPTIONS = ['Électricien','Plombier','Couvreur','Maçon','Menuisier','Peintre','Carreleur','Plaquiste','Climatisation','Multi-corps','Autre'];

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
    enabled:  isAdmin,
  });

  // Initialise la sélection avec tous les setters actifs au premier chargement
  useEffect(() => {
    if (setters && rrSetterIds.length === 0) {
      setRrSetterIds((setters as any[]).map((s) => s.id));
    }
  }, [setters]); // eslint-disable-line react-hooks/exhaustive-deps

  const buildFormData = (dryRun: boolean) => {
    if (!file) throw new Error('Fichier requis');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('assignment_mode', mode);
    if (mode === 'round_robin' && rrSetterIds.length > 0) formData.append('setter_ids', rrSetterIds.join(','));
    if (mode === 'manual' && setterId) formData.append('setter_id', setterId);
    if (source) formData.append('source', source);
    if ((source === 'instagram' || source === 'facebook') && batchNiche) formData.append('niche', batchNiche);
    if (dryRun) formData.append('dry_run', 'true');
    return formData;
  };

  const mutation = useMutation({
    mutationFn: () => leadsApi.import(buildFormData(false)).then((r) => r.data as ImportResult),
    onSuccess: (data) => {
      setResult(data);
      if (data.imported > 0) {
        toast.success(`${data.imported} lead${data.imported > 1 ? 's' : ''} importé${data.imported > 1 ? 's' : ''} !`);
        qc.invalidateQueries({ queryKey: ['leads'] });
      } else {
        toast.error('Aucun lead importé — vérifiez le format du fichier');
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Erreur lors de l\'import');
    },
  });

  const previewMutation = useMutation({
    mutationFn: () => leadsApi.import(buildFormData(true)).then((r) => r.data as DryRunResult),
    onSuccess: (data) => {
      if (data.duplicate_count > 0) {
        setPendingPreview(data);
      } else {
        mutation.mutate();
      }
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Erreur lors de l\'analyse');
    },
  });

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) { setFile(accepted[0]); setResult(null); setPendingPreview(null); }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    maxFiles: 1,
  });

  const MODE_LABELS: Record<string, string> = {
    round_robin: 'Round-robin',
    manual:      'Attribution manuelle',
    self:        'Assigné à moi',
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="card p-6">
        <h2 className="text-base font-semibold text-gray-900 mb-1">Import de leads CSV</h2>
        <p className="text-sm text-gray-500 mb-5">
          Importez un fichier CSV. Les colonnes sont détectées automatiquement (français et anglais).
        </p>

        {/* Dropzone */}
        <div
          {...getRootProps()}
          className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors
            ${isDragActive
              ? 'border-primary-400 bg-primary-50'
              : file
                ? 'border-green-400 bg-green-50'
                : 'border-gray-200 hover:border-primary-300 hover:bg-gray-50'
            }`}
        >
          <input {...getInputProps()} />
          {file ? (
            <>
              <FileText className="w-10 h-10 text-green-500 mx-auto mb-3" />
              <p className="font-medium text-green-700">{file.name}</p>
              <p className="text-xs text-green-500 mt-1">
                {(file.size / 1024).toFixed(1)} Ko — Cliquez pour changer de fichier
              </p>
            </>
          ) : (
            <>
              <Upload className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-600">
                {isDragActive ? 'Déposez ici…' : 'Glissez votre CSV ici'}
              </p>
              <p className="text-xs text-gray-400 mt-1">ou cliquez pour parcourir · .csv, .txt</p>
            </>
          )}
        </div>

        {/* Assignment — admin only */}
        {isAdmin && (
          <div className="mt-5 space-y-4">
            <div>
              <label className="label">Mode d'attribution</label>
              <div className="flex gap-3">
                {([
                  ['round_robin', 'Round-robin automatique', 'Distribue équitablement entre tous les setters actifs'],
                  ['manual',      'Attribution manuelle',     'Assigne tous les leads à un setter spécifique'],
                ] as const).map(([val, title, desc]) => (
                  <label
                    key={val}
                    className={`flex-1 p-3 rounded-lg border-2 cursor-pointer transition-all
                      ${mode === val ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
                  >
                    <input type="radio" value={val} checked={mode === val}
                      onChange={() => setMode(val)} className="sr-only" />
                    <p className="text-sm font-medium text-gray-800">{title}</p>
                    <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                  </label>
                ))}
              </div>
            </div>

            {mode === 'round_robin' && setters && (setters as any[]).length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="label mb-0">Setters inclus dans le round-robin</label>
                  <div className="flex gap-3 text-xs">
                    <button
                      type="button"
                      onClick={() => setRrSetterIds((setters as any[]).map((s) => s.id))}
                      className="text-primary-600 hover:underline"
                    >Tous</button>
                    <button
                      type="button"
                      onClick={() => setRrSetterIds([])}
                      className="text-gray-400 hover:underline"
                    >Aucun</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {(setters as any[]).map((s) => {
                    const checked = rrSetterIds.includes(s.id);
                    return (
                      <label
                        key={s.id}
                        className={`flex items-center gap-2.5 p-2.5 rounded-lg border cursor-pointer transition-all text-sm
                          ${checked ? 'border-primary-400 bg-primary-50 text-primary-800' : 'border-gray-200 text-gray-500 hover:border-gray-300'}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(e) =>
                            setRrSetterIds((prev) =>
                              e.target.checked ? [...prev, s.id] : prev.filter((id) => id !== s.id)
                            )
                          }
                          className="accent-primary-600"
                        />
                        {s.first_name} {s.last_name}
                      </label>
                    );
                  })}
                </div>
                {rrSetterIds.length === 0 && (
                  <p className="text-xs text-red-500 mt-1.5">Sélectionne au moins un setter.</p>
                )}
              </div>
            )}

            {mode === 'manual' && (
              <div>
                <label className="label">Setter assigné *</label>
                <select value={setterId} onChange={(e) => setSetterId(e.target.value)} className="select">
                  <option value="">Choisir un setter…</option>
                  {(setters as any[] | undefined)?.map((s) => (
                    <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* Source channel */}
        <div className="mt-5">
          <label className="label">Canal d'acquisition</label>
          <div className="flex gap-3">
            {([
              ['cold_call', '📞 Cold call',  'Prospection téléphonique'],
              ['instagram', '📸 Instagram',  'Leads depuis Instagram'],
              ['facebook',  '💬 Facebook',   'Leads depuis Facebook'],
            ] as const).map(([val, title, desc]) => (
              <label
                key={val}
                className={`flex-1 p-3 rounded-lg border-2 cursor-pointer transition-all
                  ${source === val ? 'border-primary-500 bg-primary-50' : 'border-gray-200 hover:border-gray-300'}`}
              >
                <input type="radio" value={val} checked={source === val}
                  onChange={() => setSource(val)} className="sr-only" />
                <p className="text-sm font-medium text-gray-800">{title}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </label>
            ))}
          </div>
        </div>

        {/* Niche batch (Instagram / Facebook) */}
        {(source === 'instagram' || source === 'facebook') && (
          <div className="mt-5">
            <label className="label">Niche du lot <span className="text-gray-400 font-normal">(optionnel — appliquée à tous les leads importés)</span></label>
            <select value={batchNiche} onChange={(e) => setBatchNiche(e.target.value)} className="select">
              <option value="">— Sans niche —</option>
              {NICHE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
        )}

        <button
          onClick={() => previewMutation.mutate()}
          disabled={
            !file || mutation.isPending || previewMutation.isPending ||
            (isAdmin && mode === 'manual' && !setterId) ||
            (isAdmin && mode === 'round_robin' && rrSetterIds.length === 0)
          }
          className="btn-primary w-full justify-center mt-6 py-2.5"
        >
          {previewMutation.isPending
            ? <><Spinner className="w-4 h-4" /> Analyse…</>
            : mutation.isPending
              ? <><Spinner className="w-4 h-4" /> Import en cours…</>
              : <><Upload className="w-4 h-4" /> Lancer l'import</>
          }
        </button>
      </div>

      {/* Duplicate confirmation */}
      {pendingPreview && (
        <div className="card p-6 border-amber-200 bg-amber-50">
          <div className="flex items-center gap-3 mb-3">
            <AlertTriangle className="w-6 h-6 text-amber-600" />
            <h3 className="font-semibold text-amber-800">
              {pendingPreview.duplicate_count} doublon{pendingPreview.duplicate_count > 1 ? 's' : ''} détecté{pendingPreview.duplicate_count > 1 ? 's' : ''} sur {pendingPreview.total} ligne{pendingPreview.total > 1 ? 's' : ''}
            </h3>
          </div>
          <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside mb-4 max-h-40 overflow-y-auto">
            {pendingPreview.duplicates.map((d, i) => <li key={i}>{d}</li>)}
          </ul>
          <div className="flex gap-3">
            <button onClick={() => setPendingPreview(null)} className="btn-secondary flex-1 justify-center">
              Annuler
            </button>
            <button
              onClick={() => { setPendingPreview(null); mutation.mutate(); }}
              className="btn-primary flex-1 justify-center"
            >
              Importer quand même
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div className={`card p-6 ${result.imported > 0 ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-orange-50'}`}>
          <div className="flex items-center gap-3 mb-4">
            {result.imported > 0
              ? <CheckCircle className="w-6 h-6 text-green-600" />
              : <AlertCircle className="w-6 h-6 text-orange-500" />
            }
            <h3 className={`font-semibold ${result.imported > 0 ? 'text-green-800' : 'text-orange-700'}`}>
              {result.imported > 0 ? 'Import terminé' : 'Aucun lead importé'}
            </h3>
          </div>

          <div className="grid grid-cols-4 gap-3 text-sm mb-4">
            <div className="bg-white rounded-lg p-3 border border-gray-100">
              <p className="text-xs text-gray-500">Importés</p>
              <p className="text-2xl font-bold text-gray-900">{result.imported}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-100">
              <p className="text-xs text-gray-500">Ignorés</p>
              <p className="text-2xl font-bold text-gray-500">{result.skipped}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-100">
              <p className="text-xs text-gray-500">Doublons</p>
              <p className={`text-2xl font-bold ${result.duplicate_count > 0 ? 'text-amber-500' : 'text-gray-400'}`}>
                {result.duplicate_count ?? 0}
              </p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-gray-100">
              <p className="text-xs text-gray-500">Mode</p>
              <p className="text-sm font-medium text-gray-700 mt-1">
                {MODE_LABELS[result.assignment_mode] ?? result.assignment_mode}
              </p>
            </div>
          </div>

          {result.duplicates && result.duplicates.length > 0 && (
            <div className="mb-4 p-3 bg-amber-50 rounded-lg border border-amber-200">
              <p className="text-xs font-medium text-amber-700 mb-1.5 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                {result.duplicate_count} doublon{result.duplicate_count > 1 ? 's' : ''} détecté{result.duplicate_count > 1 ? 's' : ''} — lead{result.duplicate_count > 1 ? 's' : ''} importé{result.duplicate_count > 1 ? 's' : ''} quand même :
              </p>
              <ul className="text-xs text-amber-700 space-y-0.5 list-disc list-inside">
                {result.duplicates.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}

          {result.errors && result.errors.length > 0 && (
            <div className="mb-4 p-3 bg-red-50 rounded-lg border border-red-100">
              <p className="text-xs font-medium text-red-700 mb-1">
                <AlertCircle className="inline w-3.5 h-3.5 mr-1" />
                Lignes ignorées :
              </p>
              <ul className="text-xs text-red-600 space-y-0.5 list-disc list-inside">
                {result.errors.map((e, i) => <li key={i}>{e}</li>)}
              </ul>
            </div>
          )}

          <button
            onClick={() => { setFile(null); setResult(null); }}
            className="btn-secondary w-full justify-center"
          >
            <RefreshCw className="w-4 h-4" />
            Nouvel import
          </button>
        </div>
      )}

      {/* Format help */}
      <div className="card p-5 space-y-5">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Format CSV standard</h3>
          <p className="text-xs text-gray-500 mb-3">
            Colonnes reconnues automatiquement (noms français ou anglais) :
          </p>
          <div className="grid grid-cols-2 gap-2 mb-3">
            {[
              ['Prénom *',      'prénom, prenom, firstname'],
              ['Nom *',         'nom, lastname'],
              ['Société',       'société, company, entreprise'],
              ['Téléphone',     'téléphone, phone, mobile, tel'],
              ['Email',         'email, mail'],
              ['Localisation',  'localisation, location, ville, city'],
              ['Notes',         'notes, commentaire'],
              ['Qualité',       'qualité, lead_quality (hot/warm/cold)'],
              ['Statut',        'statut, status (in_progress/client/lost)'],
            ].map(([field, aliases]) => (
              <div key={field} className="text-xs">
                <span className="font-medium text-gray-700">{field} : </span>
                <span className="text-gray-400">{aliases}</span>
              </div>
            ))}
          </div>
          <div className="p-2 bg-gray-50 rounded font-mono text-xs text-gray-600 whitespace-pre">
            {`prénom,nom,société,téléphone,email,ville\nJean,Dupont,Acme SA,0612345678,jean@acme.fr,Paris`}
          </div>
        </div>

        <div className="border-t border-gray-100 pt-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">
            📸 Format Apify Instagram Profile Scraper
          </h3>
          <p className="text-xs text-gray-500 mb-3">
            Le CSV exporté depuis Apify est reconnu directement. Sélectionnez <strong>Instagram</strong> comme canal.
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              ['Société',      'full_name'],
              ['Bio → Notes',  'biography'],
              ['Notes',        '@username, profile_url, source_hashtag'],
              ['Qualité auto', 'score ≥ 15 → hot · ≥ 8 → warm · < 8 → cold'],
            ].map(([field, aliases]) => (
              <div key={field} className="text-xs">
                <span className="font-medium text-gray-700">{field} : </span>
                <span className="text-gray-400">{aliases}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
