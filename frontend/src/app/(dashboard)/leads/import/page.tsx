'use client';
import { useState, useCallback } from 'react';
import { useDropzone } from 'react-dropzone';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload, FileText, CheckCircle, AlertCircle, Users, RefreshCw } from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Spinner from '@/components/ui/Spinner';

export default function ImportPage() {
  const user    = useAuthStore((s) => s.user);
  const qc      = useQueryClient();

  const [file,       setFile]       = useState<File | null>(null);
  const [mode,       setMode]       = useState<'round_robin' | 'manual'>('round_robin');
  const [setterId,   setSetterId]   = useState('');
  const [result,     setResult]     = useState<any>(null);

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
  });

  const mutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Fichier requis');
      const formData = new FormData();
      formData.append('file', file);
      formData.append('assignment_mode', mode);
      if (mode === 'manual' && setterId) formData.append('setter_id', setterId);
      return leadsApi.import(formData).then((r) => r.data);
    },
    onSuccess: (data) => {
      setResult(data);
      toast.success(`${data.total} leads importés avec succès !`);
      qc.invalidateQueries({ queryKey: ['leads'] });
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Erreur lors de l\'import');
    },
  });

  const onDrop = useCallback((accepted: File[]) => {
    if (accepted[0]) { setFile(accepted[0]); setResult(null); }
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'text/csv': ['.csv'], 'text/plain': ['.txt'] },
    maxFiles: 1,
  });

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

        {/* Assignment mode */}
        <div className="mt-5 space-y-4">
          <div>
            <label className="label">Mode d'attribution</label>
            <div className="flex gap-3">
              {([
                ['round_robin', 'Round-robin automatique', 'Distribue équitablement entre tous les setters'],
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

          {mode === 'manual' && (
            <div>
              <label className="label">Setter assigné *</label>
              <select
                value={setterId}
                onChange={(e) => setSetterId(e.target.value)}
                className="select"
              >
                <option value="">Choisir un setter…</option>
                {setters?.map((s: any) => (
                  <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
                ))}
              </select>
            </div>
          )}
        </div>

        <button
          onClick={() => mutation.mutate()}
          disabled={!file || mutation.isPending || (mode === 'manual' && !setterId)}
          className="btn-primary w-full justify-center mt-6 py-2.5"
        >
          {mutation.isPending ? <><Spinner className="w-4 h-4" /> Import en cours…</> : <><Upload className="w-4 h-4" /> Lancer l'import</>}
        </button>
      </div>

      {/* Result */}
      {result && (
        <div className="card p-6 border-green-200 bg-green-50">
          <div className="flex items-center gap-3 mb-4">
            <CheckCircle className="w-6 h-6 text-green-600" />
            <h3 className="font-semibold text-green-800">Import réussi !</h3>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="bg-white rounded-lg p-3 border border-green-100">
              <p className="text-xs text-gray-500">Leads importés</p>
              <p className="text-2xl font-bold text-gray-900">{result.total}</p>
            </div>
            <div className="bg-white rounded-lg p-3 border border-green-100">
              <p className="text-xs text-gray-500">Mode</p>
              <p className="font-medium text-gray-700 capitalize mt-1">{result.assignment_mode}</p>
            </div>
          </div>
          <button
            onClick={() => { setFile(null); setResult(null); }}
            className="btn-secondary w-full justify-center mt-4"
          >
            <RefreshCw className="w-4 h-4" />
            Nouvel import
          </button>
        </div>
      )}

      {/* Format help */}
      <div className="card p-5">
        <h3 className="text-sm font-semibold text-gray-900 mb-3">Format attendu</h3>
        <p className="text-xs text-gray-500 mb-3">
          Les colonnes suivantes sont reconnues automatiquement (noms français ou anglais) :
        </p>
        <div className="grid grid-cols-2 gap-2">
          {[
            ['Prénom',       'prénom, prenom, firstname'],
            ['Nom',          'nom, lastname, surname'],
            ['Société',      'société, company, entreprise'],
            ['Téléphone',    'téléphone, phone, mobile, tel'],
            ['Email',        'email, e-mail, mail'],
            ['Localisation', 'localisation, location, ville, city'],
          ].map(([field, aliases]) => (
            <div key={field} className="text-xs">
              <span className="font-medium text-gray-700">{field} : </span>
              <span className="text-gray-400">{aliases}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 p-2 bg-gray-50 rounded font-mono text-xs text-gray-600">
          prénom,nom,société,téléphone,email,localisation<br />
          Jean,Dupont,Acme SA,0612345678,jean@acme.fr,Paris
        </div>
      </div>
    </div>
  );
}
