'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/authStore';
import {
  ArrowLeft, Upload, FileSpreadsheet, Loader2, AlertCircle, Globe, Instagram, Phone,
} from 'lucide-react';

interface PreviewResult {
  headers: string[];
  suggested: string | null;
  total: number;
}

interface Counts {
  no_website: number;
  instagram: number;
  website: number;
}

export default function CsvWebsiteFilterPage() {
  const user   = useAuthStore((s) => s.user);
  const router = useRouter();

  useEffect(() => {
    if (user && user.role !== 'admin') router.replace('/dashboard');
  }, [user, router]);

  const [file, setFile]           = useState<File | null>(null);
  const [preview, setPreview]     = useState<PreviewResult | null>(null);
  const [column, setColumn]       = useState('');
  const [counts, setCounts]       = useState<Counts | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [categorizing, setCategorizing] = useState(false);
  const [exporting, setExporting] = useState<'no_website' | 'instagram' | null>(null);
  const [error, setError]         = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function callApi(fd: FormData) {
    const res = await fetch('/api/admin/csv-website-filter', {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('pf_token')}` },
      body: fd,
    });
    return res;
  }

  async function analyze(selected: File) {
    setError(null);
    setPreview(null);
    setCounts(null);
    setAnalyzing(true);
    try {
      const fd = new FormData();
      fd.append('file', selected);
      const res = await callApi(fd);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Erreur lors de l\'analyse');
      setPreview(json);
      setColumn(json.suggested ?? '');
      if (json.suggested) categorize(selected, json.suggested);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAnalyzing(false);
    }
  }

  async function categorize(selected: File, col: string) {
    setError(null);
    setCounts(null);
    setCategorizing(true);
    try {
      const fd = new FormData();
      fd.append('file', selected);
      fd.append('column', col);
      const res = await callApi(fd);
      const json = await res.json();
      if (!res.ok) throw new Error(json.message || 'Erreur lors de l\'analyse');
      setCounts(json);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setCategorizing(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFile(f);
    analyze(f);
  }

  function handleColumnChange(col: string) {
    setColumn(col);
    if (file && col) categorize(file, col);
    else setCounts(null);
  }

  async function handleExport(type: 'no_website' | 'instagram') {
    if (!file || !column) return;
    setExporting(type);
    setError(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('column', column);
      fd.append('export', type);
      const res = await callApi(fd);
      if (!res.ok) {
        const json = await res.json();
        throw new Error(json.message || 'Erreur lors de l\'export');
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = type === 'no_website' ? 'sans_site_web.csv' : 'instagram_sourcing.csv';
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExporting(null);
    }
  }

  function reset() {
    setFile(null);
    setPreview(null);
    setColumn('');
    setCounts(null);
    setError(null);
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
          <h1 className="text-base font-bold text-gray-900">Trier les leads par site web</h1>
          <p className="text-sm text-gray-500">
            Importe un CSV scrappé et sépare les leads sans site, avec profil Instagram, ou avec un vrai site.
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
                Quelle colonne correspond au site web / lien ?
              </label>
              <select
                value={column}
                onChange={(e) => handleColumnChange(e.target.value)}
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

            {categorizing && (
              <div className="flex items-center gap-2 text-sm text-gray-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Tri des lignes…
              </div>
            )}

            {counts && !categorizing && (
              <>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="card p-3 bg-amber-50">
                    <p className="text-xl font-bold text-amber-700">{counts.no_website}</p>
                    <p className="text-gray-500 mt-0.5">Sans site</p>
                  </div>
                  <div className="card p-3 bg-pink-50">
                    <p className="text-xl font-bold text-pink-700">{counts.instagram}</p>
                    <p className="text-gray-500 mt-0.5">Profil Instagram</p>
                  </div>
                  <div className="card p-3 bg-gray-50">
                    <p className="text-xl font-bold text-gray-700">{counts.website}</p>
                    <p className="text-gray-500 mt-0.5">Vrai site (exclus)</p>
                  </div>
                </div>

                <div className="flex flex-col gap-2">
                  <button
                    onClick={() => handleExport('no_website')}
                    disabled={exporting !== null || counts.no_website === 0}
                    className="btn-primary justify-center gap-1.5 disabled:opacity-50"
                  >
                    {exporting === 'no_website'
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Phone className="w-4 h-4" />}
                    Télécharger "sans site web" ({counts.no_website})
                  </button>
                  <button
                    onClick={() => handleExport('instagram')}
                    disabled={exporting !== null || counts.instagram === 0}
                    className="btn-secondary justify-center gap-1.5 disabled:opacity-50 border-pink-200 text-pink-700 hover:bg-pink-50"
                  >
                    {exporting === 'instagram'
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Instagram className="w-4 h-4" />}
                    Télécharger "Instagram sourcing" ({counts.instagram})
                  </button>
                </div>
              </>
            )}

            <button onClick={reset} className="btn-secondary w-full justify-center">
              Nouveau fichier
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
