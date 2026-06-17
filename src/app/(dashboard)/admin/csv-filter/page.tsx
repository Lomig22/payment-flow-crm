'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import {
  ArrowLeft, Upload, FileSpreadsheet, Download, Loader2, AlertCircle, CheckCircle2, Globe,
} from 'lucide-react';

interface PreviewResult {
  headers: string[];
  suggested: string | null;
  total: number;
}

export default function CsvWebsiteFilterPage() {
  const user   = useAuthStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== 'admin') router.replace('/dashboard');
  }, [user, router]);

  const [file, setFile]         = useState<File | null>(null);
  const [preview, setPreview]   = useState<PreviewResult | null>(null);
  const [column, setColumn]     = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError]       = useState<string | null>(null);
  const [done, setDone]         = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  async function analyze(selected: File) {
    setError(null);
    setDone(false);
    setPreview(null);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append('file', selected);
      const res = await fetch('/api/admin/csv-website-filter', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('pf_token')}` },
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Erreur lors de l\'analyse');
      setPreview(json);
      setColumn(json.suggested ?? '');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    analyze(f);
  }

  async function handleExport() {
    if (!file || !column) return;
    setExporting(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('column', column);
      const res = await fetch('/api/admin/csv-website-filter', {
        method: 'POST',
        headers: { Authorization: `Bearer ${localStorage.getItem('pf_token')}` },
        body: fd,
      });
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.message || 'Erreur lors de l\'export');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'sans_site_web.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setDone(true);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(false);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setColumn('');
    setError(null);
    setDone(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <button
        onClick={() => router.push('/admin')}
        className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700"
      >
        <ArrowLeft className="w-4 h-4" /> Retour à l'admin
      </button>

      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
          <Globe className="w-5 h-5 text-indigo-500" />
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900">Filtrer les leads sans site web</h1>
          <p className="text-sm text-gray-500">
            Importe un CSV (Instant Data Scraper) et récupère uniquement les lignes sans site web.
          </p>
        </div>
      </div>

      {/* Upload */}
      <div className="card p-6">
        <label
          htmlFor="csv-upload"
          className="flex flex-col items-center justify-center gap-2 border-2 border-dashed border-gray-200 rounded-xl py-10 cursor-pointer hover:border-indigo-300 hover:bg-indigo-50/30 transition-colors"
        >
          <Upload className="w-7 h-7 text-gray-400" />
          <p className="text-sm font-medium text-gray-700">
            {file ? file.name : 'Clique pour choisir un fichier CSV'}
          </p>
          <p className="text-xs text-gray-400">Export Instant Data Scraper, Google Maps, Pages Jaunes…</p>
          <input
            ref={inputRef}
            id="csv-upload"
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={handleFileChange}
          />
        </label>

        {analyzing && (
          <div className="mt-4 flex items-center gap-2 text-sm text-gray-500">
            <Loader2 className="w-4 h-4 animate-spin" /> Analyse du fichier…
          </div>
        )}

        {error && (
          <div className="mt-4 flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            <AlertCircle className="w-4 h-4 flex-shrink-0" /> {error}
          </div>
        )}

        {preview && !analyzing && (
          <div className="mt-5 space-y-4">
            <div className="flex items-center gap-2 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
              <FileSpreadsheet className="w-4 h-4 text-gray-400 flex-shrink-0" />
              {preview.total} ligne{preview.total > 1 ? 's' : ''} détectée{preview.total > 1 ? 's' : ''} dans le fichier.
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">
                Quelle colonne correspond au site web ?
              </label>
              <select
                value={column}
                onChange={(e) => setColumn(e.target.value)}
                className="select w-full"
              >
                <option value="">— Choisir une colonne —</option>
                {preview.headers.map((h) => (
                  <option key={h} value={h}>{h}</option>
                ))}
              </select>
              {!preview.suggested && (
                <p className="text-xs text-amber-600 mt-1">
                  Colonne site web non détectée automatiquement — sélectionne-la manuellement.
                </p>
              )}
            </div>

            {done && (
              <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                <CheckCircle2 className="w-4 h-4 flex-shrink-0" /> Fichier exporté avec succès.
              </div>
            )}

            <div className="flex gap-3">
              <button onClick={reset} className="btn-secondary flex-1 justify-center">
                Nouveau fichier
              </button>
              <button
                onClick={handleExport}
                disabled={!column || exporting}
                className="btn-primary flex-1 justify-center gap-1.5 disabled:opacity-50"
              >
                {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                Télécharger le CSV filtré
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
