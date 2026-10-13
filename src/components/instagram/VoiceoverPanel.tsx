'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Mic, Loader2, Sparkles, Save, ChevronDown, ChevronUp, AlertTriangle, ShieldCheck, Play } from 'lucide-react';
import toast from 'react-hot-toast';
import { queueApi, type QueueItem, type VoSegment, type VoIntention, type VoiceoverState } from '@/lib/api';

// Voix off de Lomig sur un reel (src/lib/voiceover.ts) : script hook + corps annoté, voix
// contrôlée phrase par phrase, montage, puis vérification du rendu. Le cron fait tout seul ;
// ce panneau sert à suivre, corriger le texte et relancer.
const LANG: Record<string, string> = { fr: 'français', en: 'anglais', pt: 'portugais', es: 'espagnol', it: 'italien', de: 'allemand', ar: 'arabe', vi: 'vietnamien', zh: 'chinois', ru: 'russe', tr: 'turc' };

const INTENTION_CLS: Record<VoIntention, string> = {
  CHOC: 'bg-red-100 text-red-700', GRAVE: 'bg-slate-200 text-slate-700', SUSPENSE: 'bg-violet-100 text-violet-700',
  ENERGIQUE: 'bg-amber-100 text-amber-700', INSISTANCE: 'bg-blue-100 text-blue-700', CONFIDENCE: 'bg-pink-100 text-pink-700',
  CONCLUSION: 'bg-green-100 text-green-700',
};
const SUBJECT_LABEL: Record<string, string> = {
  S1: 'Répondre au téléphone', S2: 'Fiche Google', S3: 'Avis clients', S4: 'Prix affichés', S5: 'Photos de chantiers',
  S6: 'Relance des devis', S7: 'Site internet', S8: 'Bouche-à-oreille', S9: 'Plateformes de mise en relation',
  S10: 'Choisir ses chantiers', S11: 'Délai de réponse au devis', S12: 'Fondations avant visibilité',
};

function StatusBadge({ vo }: { vo?: VoiceoverState }) {
  if (!vo) return <span className="badge bg-gray-100 text-gray-600">Pas de VF</span>;
  if (vo.status === 'done' && vo.verify?.ok) return <span className="badge bg-green-100 text-green-700"><ShieldCheck className="w-3 h-3" /> VF vérifiée</span>;
  if (vo.status === 'done' && vo.verify && !vo.verify.ok) return <span className="badge bg-red-100 text-red-700" title={vo.verify.extra.join(', ')}><AlertTriangle className="w-3 h-3" /> Autre voix détectée</span>;
  const map: Record<VoiceoverState['status'], [string, string]> = {
    script: ['Script prêt', 'bg-violet-100 text-violet-700'], voicing: ['Voix en cours…', 'bg-amber-100 text-amber-700'],
    voiced: ['Voix prête', 'bg-violet-100 text-violet-700'], rendering: ['Montage…', 'bg-amber-100 text-amber-700'],
    done: ['Contrôle en attente', 'bg-amber-100 text-amber-700'], verifying: ['Contrôle…', 'bg-amber-100 text-amber-700'],
    error: ['Erreur', 'bg-red-100 text-red-700'], skipped: ['Sans VF (pas de voix d\u2019origine)', 'bg-gray-100 text-gray-600'],
  };
  const [label, cls] = map[vo.status];
  return <span className={`badge ${cls}`} title={vo.error}>{['voicing', 'rendering', 'verifying'].includes(vo.status) && <Loader2 className="w-3 h-3 animate-spin" />} {label}</span>;
}

export default function VoiceoverPanel({ q, onChange }: { q: QueueItem; onChange: () => void }) {
  const audio = q.clean_report?.audio;
  const vo    = q.clean_report?.voiceover;
  const [open, setOpen]         = useState(false);
  const [segments, setSegments] = useState<VoSegment[]>(vo?.segments ?? []);
  const [running, setRunning]   = useState<string | null>(null);
  const dirty = JSON.stringify(segments.map((s) => s.text)) !== JSON.stringify((vo?.segments ?? []).map((s) => s.text));
  useEffect(() => { setSegments(vo?.segments ?? []); }, [vo?.updated_at]);   // eslint-disable-line react-hooks/exhaustive-deps

  const { data: cfg } = useQuery({
    queryKey: ['voiceover-enabled'],
    queryFn: () => queueApi.voiceoverEnabled().then((r) => r.data),
    staleTime: 10 * 60_000,
  });

  const newScript = useMutation({
    mutationFn: () => queueApi.voiceover(q.id, { action: 'script', force: true }).then((r) => r.data),
    onSuccess: (s) => { setSegments(s.segments); setOpen(true); toast.success('Nouveau script'); onChange(); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });
  const save = useMutation({
    mutationFn: () => queueApi.voiceover(q.id, { action: 'save', segments }).then((r) => r.data),
    onSuccess: () => { toast.success('Script enregistré : la voix sera refaite'); onChange(); },
    onError: (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });

  // Enchaîne les étapes (voix → montage → contrôle), une requête par étape
  const runAll = async () => {
    try {
      if (dirty) await queueApi.voiceover(q.id, { action: 'save', segments });
      setRunning('Étape en cours…');
      for (let i = 0; i < 5; i++) {
        const { data } = await queueApi.voiceoverStep(q.id);
        const label = { script: 'Script écrit', voice: 'Voix générée et contrôlée', render: 'Montage terminé', verify: 'Rendu vérifié' }[data.step];
        if (label) setRunning(label + '…');
        onChange();
        if (data.step === 'none' || (data.step === 'verify')) {
          if (data.state.verify?.ok) toast.success('VF montée et vérifiée ✅');
          else if (data.state.verify) toast.error('Une autre voix a été détectée dans le rendu : pas de publication');
          break;
        }
      }
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Erreur');
    } finally {
      setRunning(null);
      onChange();
    }
  };

  const takes = vo?.takes ?? [];
  const regenerated = takes.filter((t) => t.attempts > 1).length;

  return (
    <div className="mt-2 rounded-lg border border-gray-100 bg-gray-50/60 p-2.5">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Mic className="w-3.5 h-3.5 text-gray-500" />
        <span className="font-medium text-gray-700">Voix off</span>
        <StatusBadge vo={vo} />
        {vo?.hook && (
          <span className="badge bg-gray-100 text-gray-600" title={vo.segments[0]?.text}>
            {vo.hook} · {SUBJECT_LABEL[vo.subject ?? ''] ?? vo.subject}
          </span>
        )}
        {audio && (audio.voice
          ? <span className="badge bg-red-50 text-red-700" title={audio.excerpt ?? undefined}>Voix d&apos;origine en {LANG[audio.language ?? ''] ?? audio.language} : retirée</span>
          : <span className="badge bg-gray-100 text-gray-600">{audio.kind === 'musique_seule' ? 'Musique d’origine gardée' : audio.kind === 'sons_ambiants' ? 'Bruits de chantier gardés' : 'Sans voix d’origine'}</span>)}
        {vo?.model && <span className="badge bg-gray-100 text-gray-500">{vo.model === 'eleven_v3' ? 'ElevenLabs v3' : 'ElevenLabs v2'}</span>}
        {takes.length > 0 && <span className="text-gray-400">{takes.length} paragraphes · {regenerated} refait(s)</span>}
        <div className="ml-auto flex items-center gap-2">
          {segments.length > 0 && (
            <button onClick={() => setOpen((v) => !v)} className="text-gray-600 hover:underline flex items-center gap-1">
              {segments.length} phrases {open ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          )}
          <button onClick={() => newScript.mutate()} disabled={newScript.isPending || !!running}
            className="text-violet-700 hover:underline flex items-center gap-1">
            {newScript.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
            Nouveau script
          </button>
          <button onClick={runAll} disabled={!!running || !cfg?.enabled}
            title={cfg?.enabled ? 'Voix, montage et contrôle, à la suite' : 'ElevenLabs pas encore configuré'}
            className="btn-primary btn-sm">
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Play className="w-3.5 h-3.5" />}
            {vo?.status === 'done' ? 'Refaire la VF' : 'Monter la VF'}
          </button>
        </div>
      </div>
      {running && <p className="mt-1.5 text-[11px] text-gray-500">{running} (1 à 4 min par étape)</p>}
      {vo?.error && <p className="mt-1.5 text-xs text-red-600">{vo.error}</p>}
      {vo?.verify && !vo.verify.ok && (
        <p className="mt-1.5 text-xs text-red-600">Mots entendus hors script et hors CTA : {vo.verify.extra.join(', ')}</p>
      )}
      {!cfg?.auto && cfg?.enabled && <p className="mt-1.5 text-[11px] text-gray-400">Mode automatique désactivé : la VF se monte avec le bouton.</p>}

      {open && segments.length > 0 && (
        <div className="mt-2 space-y-1.5">
          {segments.map((s, i) => {
            return (
              <div key={i} className="flex gap-2 items-start">
                <span className={`badge w-24 justify-center flex-shrink-0 mt-1 ${INTENTION_CLS[s.intention] ?? 'bg-gray-100 text-gray-600'}`}>{s.intention}</span>
                <div className="flex-1">
                  <textarea value={s.text} rows={1} disabled={i === 0 && !!vo?.hook}
                    title={i === 0 && vo?.hook ? 'Hook de la banque : texte exact, non modifiable' : undefined}
                    onChange={(e) => setSegments(segments.map((x, k) => (k === i ? { ...x, text: e.target.value } : x)))}
                    className="input py-1 text-sm resize-y disabled:bg-gray-100" />
                </div>
              </div>
            );
          })}
          {dirty && (
            <div className="flex justify-end pt-1">
              <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-secondary btn-sm">
                <Save className="w-3.5 h-3.5" /> Enregistrer
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
