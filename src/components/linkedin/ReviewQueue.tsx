'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Pencil, X, ExternalLink, FlaskConical } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinApi, type LinkedinReviewItem, type LinkedinSettings } from '@/lib/api';
import { QUESTION_LABELS, STAGE_LABELS, type Question } from '@/lib/linkedinLabels';
import { VARIANT_BADGE, fullName, apiError } from './shared';

// File « À valider » : premiers messages et relances post rédigés par l'agent. Valider, modifier
// puis valider, ou rejeter (variante C pour un premier message, relance prévue pour une relance post).
// Les messages « test » (aperçus) ne partent jamais : l'avis de Lomig sert au contrôle qualité.

const CONFIANCE: Record<string, string> = { haute: 'text-green-700', moyenne: 'text-amber-700', faible: 'text-red-600' };

function ReviewItem({ item }: { item: LinkedinReviewItem }) {
  const qc = useQueryClient();
  const p = item.li_pending;
  const [text, setText] = useState(p.message);
  const edited = text.trim() !== p.message.trim();
  const decide = useMutation({
    mutationFn: ({ action, message }: { action: 'validate' | 'edit' | 'reject'; message?: string }) => linkedinApi.decide(action, item.id, message),
    onSuccess: (_, { action }) => {
      toast.success(action === 'reject' ? (p.stage === 'first' ? 'Rejeté : variante C' : 'Rejeté : relance prévue') : 'Validé');
      qc.invalidateQueries({ queryKey: ['linkedin'] });
    },
    onError: (e) => toast.error(apiError(e)),
  });
  const kind = p.kind === 'post' ? 'post' : p.stage;

  return (
    <div className="rounded-lg border border-gray-200 p-4 space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Link href={`/leads/${item.id}`} className="font-semibold text-gray-900 hover:underline">{fullName(item)}</Link>
        <span className="text-gray-500">{[item.job_title, item.company].filter(Boolean).join(' · ')}</span>
        {item.linkedin_url && (
          <a href={item.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0a66c2]"><ExternalLink className="w-3.5 h-3.5" /></a>
        )}
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          {item.li_preview && <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-violet-50 text-violet-700"><FlaskConical className="w-3 h-3" /> test, jamais envoyé</span>}
          <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{STAGE_LABELS[kind]}</span>
          {p.variante && <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold ${VARIANT_BADGE[p.variante]}`}>{p.variante}</span>}
          {p.question && <span className="text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-700">{QUESTION_LABELS[p.question as Question]}</span>}
          {p.confiance && <span className={`text-[11px] font-medium ${CONFIANCE[p.confiance] ?? ''}`}>confiance {p.confiance}</span>}
        </span>
      </div>

      <div>
        <textarea className="input min-h-[96px] resize-y text-sm" value={text} onChange={(e) => setText(e.target.value)} />
        <p className={`text-[11px] ${text.length > 300 ? 'text-red-600' : 'text-gray-400'}`}>{text.length} / 300 caractères</p>
      </div>

      {(p.element_cite || p.raison) && (
        <div className="text-xs text-gray-600 space-y-1">
          {p.element_cite && (
            <p>
              <span className="font-medium text-gray-700">Élément cité :</span> {p.element_cite}
              {p.source && (/^https?:/.test(p.source)
                ? <> · <a href={p.source.split(' ')[0]} target="_blank" rel="noreferrer" className="text-[#0a66c2] hover:underline">voir la source</a>{p.source.includes(' — ') && ` (${p.source.split(' — ')[1]})`}</>
                : <> · {p.source}</>)}
            </p>
          )}
          {p.raison && <p><span className="font-medium text-gray-700">Pourquoi pas A ou B :</span> {p.raison}</p>}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <button className="btn-primary btn-sm" disabled={decide.isPending || edited}
          onClick={() => decide.mutate({ action: 'validate' })} title={edited ? 'Texte modifié : utilisez « Modifier puis valider »' : undefined}>
          <Check className="w-3.5 h-3.5" /> Valider
        </button>
        <button className="btn-secondary btn-sm" disabled={decide.isPending || !edited}
          onClick={() => decide.mutate({ action: 'edit', message: text })}>
          <Pencil className="w-3.5 h-3.5" /> Modifier puis valider
        </button>
        <button className="btn-secondary btn-sm text-red-600" disabled={decide.isPending}
          onClick={() => decide.mutate({ action: 'reject' })}>
          <X className="w-3.5 h-3.5" /> Rejeter ({p.stage === 'first' ? 'variante C' : 'relance prévue'})
        </button>
      </div>
    </div>
  );
}

export default function ReviewQueue({ items, settings, previewWaiting }: { items: LinkedinReviewItem[]; settings: LinkedinSettings; previewWaiting: number }) {
  const real = items.filter((i) => !i.li_preview).length;
  return (
    <div className="card p-5 space-y-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <p className="text-sm font-semibold text-gray-900">À valider ({items.length})</p>
        <span className="text-xs text-gray-500">
          {settings.manual_validation
            ? <>Validation manuelle active : {settings.validated_count} / {settings.validation_target} messages validés, puis elle se désactive.</>
            : <>Validation manuelle désactivée : les messages de l&apos;agent partent sans validation.</>}
          {real > 0 && ` ${real} message(s) attendent avant de pouvoir partir.`}
        </span>
      </div>
      {previewWaiting > 0 && (
        <p className="text-xs text-violet-700">Test en cours : {previewWaiting} profil(s) à visiter par le worker (une visite toutes les quelques minutes, dans la fenêtre d&apos;envoi).</p>
      )}
      {items.length === 0
        ? <p className="text-sm text-gray-400">Rien à valider.</p>
        : <div className="space-y-3">{items.map((i) => <ReviewItem key={`${i.id}-${i.li_pending.generated_at}`} item={i} />)}</div>}
    </div>
  );
}
