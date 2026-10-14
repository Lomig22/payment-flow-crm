'use client';
import { Fragment, useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, RotateCcw, Trash2, CalendarClock, ExternalLink } from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, linkedinApi, type LinkedinLead, type LinkedinSettings } from '@/lib/api';
import type { Lead, LinkedinStatus } from '@/types';
import { LI_STATUS_LABELS, SECTORS, QUESTION_LABELS, STAGE_LABELS, type Question } from '@/lib/linkedinLabels';
import { STATUS_BADGE, VARIANT_BADGE, fmtTime, fullName, apiError } from './shared';

// Leads de la séquence, avec pour chacun la dernière étape faite et la prochaine prévue (date
// estimée pour les invitations : file d'attente × montée en charge). Une ligne se déplie sur
// l'historique horodaté du lead (invitation, acceptation, messages envoyés avec leur texte…).

const STATUSES = Object.keys(LI_STATUS_LABELS) as LinkedinStatus[];
const DAY = 86_400_000;

function fmtDay(iso: string): string {
  const d = new Date(iso);
  const key = (x: Date) => x.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  if (key(d) === key(new Date())) return 'aujourd\'hui';
  if (key(d) === key(new Date(Date.now() + DAY))) return 'demain';
  return d.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' });
}
const when = (iso: string | null | undefined) => (!iso ? '' : new Date(iso).getTime() <= Date.now() ? 'dès que possible' : `le ${fmtTime(iso)}`);

export function lastStep(l: LinkedinLead): { label: string; at: string | null } {
  if (l.li_replied_at) return { label: 'A répondu', at: l.li_replied_at };
  if (l.li_last_sent_at) return { label: `${STAGE_LABELS[l.li_last_kind ?? 'first'] ?? 'Message'} envoyé`, at: l.li_last_sent_at };
  if (l.li_expired_at) return { label: 'Invitation retirée', at: l.li_expired_at };
  if (l.li_connected_at) return { label: 'Invitation acceptée', at: l.li_connected_at };
  if (l.li_invited_at) return { label: 'Invitation envoyée', at: l.li_invited_at };
  return { label: 'Ajouté à la séquence', at: l.li_enqueued_at };
}

export function nextStep(l: LinkedinLead, s: LinkedinSettings): { label: string; at: string | null } {
  const R: Record<string, string> = { first_sent: 'R1 (ou relance post)', r1_sent: 'R2 (ou relance post)', r2_sent: 'R3 (ou relance post)' };
  switch (l.li_status) {
    case 'to_invite':
      if (l.invite_forecast) return { label: `Invitation prévue ${fmtDay(l.invite_forecast)}`, at: l.invite_forecast };
      return { label: s.enabled ? 'Invitation : au-delà des plafonds actuels' : 'Invitation : séquence en pause', at: null };
    case 'invited': {
      const withdraw = l.li_invited_at ? new Date(new Date(l.li_invited_at).getTime() + s.invite_expiry_days * DAY).toISOString() : null;
      return { label: `En attente d'acceptation, vérifiée toutes les 15 min (retrait le ${withdraw ? fmtDay(withdraw) : '—'})`, at: withdraw };
    }
    case 'connected':   return { label: `Visite du profil puis rédaction ; premier message prévu ${when(l.li_due_at)}`, at: l.li_due_at };
    case 'to_validate': return { label: `Message prêt : à valider par vous (envoi prévu ${when(l.li_due_at)} une fois validé)`, at: l.li_due_at };
    case 'ready':       return { label: `Envoi du premier message ${when(l.li_due_at)}`, at: l.li_due_at };
    case 'first_sent': case 'r1_sent': case 'r2_sent':
      return { label: `${R[l.li_status]} ${when(l.li_due_at)}`, at: l.li_due_at };
    case 'r3_sent':     return { label: `Fin de séquence ${when(l.li_due_at)}`, at: l.li_due_at };
    case 'to_resume':   return { label: l.li_handled_at ? 'Traité' : 'À vous de répondre', at: null };
    case 'failed':      return { label: l.li_error ?? 'Erreur', at: null };
    default:            return { label: '', at: null };
  }
}

function History({ id, l }: { id: string; l: LinkedinLead }) {
  const { data, isLoading } = useQuery({ queryKey: ['lead', id], queryFn: () => leadsApi.getOne(id).then((r) => r.data as Lead) });
  const events = (data?.history ?? []).filter((h: any) => h.field_changed === 'li_status' || String(h.action_note ?? '').startsWith('LinkedIn'));
  return (
    <div className="pl-8 pr-2 py-3 bg-gray-50 text-xs space-y-1">
      <div className="flex flex-wrap gap-3 text-gray-500 mb-2">
        {l.li_sector && <span>{SECTORS[l.li_sector]}</span>}
        {l.linkedin_url && <a href={l.linkedin_url} target="_blank" rel="noreferrer" className="text-[#0a66c2] hover:underline inline-flex items-center gap-1">Profil LinkedIn <ExternalLink className="w-3 h-3" /></a>}
        {l.li_thread_url && <a href={l.li_thread_url} target="_blank" rel="noreferrer" className="text-[#0a66c2] hover:underline">Conversation</a>}
        <Link href={`/leads/${id}`} className="hover:underline">Fiche du lead</Link>
      </div>
      {isLoading && <p className="text-gray-400">Chargement de l&apos;historique…</p>}
      {!isLoading && !events.length && <p className="text-gray-400">Aucun événement pour l&apos;instant.</p>}
      {events.map((h: any) => (
        <div key={h.id} className="flex gap-3">
          <span className="text-gray-400 tabular-nums w-28 flex-shrink-0">{fmtTime(h.created_at)}</span>
          <span className="text-gray-700 whitespace-pre-wrap">{String(h.action_note ?? '').replace(/^LinkedIn : /, '') || `${h.old_value ?? ''} → ${h.new_value ?? ''}`}</span>
        </div>
      ))}
    </div>
  );
}

export default function LeadsTimeline({ leads, settings }: { leads: LinkedinLead[]; settings: LinkedinSettings }) {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<LinkedinStatus | 'all'>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [open, setOpen] = useState<string | null>(null);
  const act = useMutation({
    mutationFn: ({ action, ids }: { action: 'requeue' | 'remove'; ids: string[] }) => linkedinApi.leadsAction(action, ids),
    onSuccess: (_, { action }) => { toast.success(action === 'requeue' ? 'Remis dans la séquence' : 'Retiré(s) de la séquence'); setSelected(new Set()); qc.invalidateQueries({ queryKey: ['linkedin'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of leads) if (l.li_status) c[l.li_status] = (c[l.li_status] ?? 0) + 1;
    return c;
  }, [leads]);
  // Tri : prochaine échéance d'abord, puis les leads sans date
  const rows = useMemo(() => leads
    .filter((l) => filter === 'all' || l.li_status === filter)
    .map((l) => ({ l, last: lastStep(l), next: nextStep(l, settings) }))
    .sort((a, b) => (a.next.at ? new Date(a.next.at).getTime() : Infinity) - (b.next.at ? new Date(b.next.at).getTime() : Infinity)), [leads, filter, settings]);

  return (
    <div className="card p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <CalendarClock className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Leads de la séquence ({leads.length})</p>
        <span className="text-xs text-gray-500">Triés par prochaine échéance. Cliquez sur une ligne pour voir son historique.</span>
        <p className="w-full text-xs text-gray-500">
          Délais : acceptations vérifiées toutes les 15 min (lun.–ven., 9 h – 18 h 30) → visite du profil et rédaction du message →
          premier message {settings.first_msg_min_hours} à {settings.first_msg_max_hours} h après l&apos;acceptation → R1, R2, R3 à J+{settings.r1_days}, J+{settings.r2_days}, J+{settings.r3_days} ouvrés.
          {settings.manual_validation && <span className="text-amber-700"> Validation manuelle active : chaque premier message attend votre validation (onglet « À valider ») avant de partir.</span>}
        </p>
        {selected.size > 0 && (
          <div className="ml-auto flex gap-2">
            <button className="btn-secondary btn-sm" onClick={() => act.mutate({ action: 'requeue', ids: Array.from(selected) })}><RotateCcw className="w-3.5 h-3.5" /> Remettre (erreurs)</button>
            <button className="btn-secondary btn-sm" onClick={() => act.mutate({ action: 'remove', ids: Array.from(selected) })}><Trash2 className="w-3.5 h-3.5" /> Retirer de la séquence</button>
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <button onClick={() => setFilter('all')} className={`text-xs px-2 py-1 rounded-full ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-600'}`}>Tous</button>
        {STATUSES.filter((st) => counts[st]).map((st) => (
          <button key={st} onClick={() => setFilter(st)} className={`text-xs px-2 py-1 rounded-full ${filter === st ? 'bg-gray-900 text-white' : STATUS_BADGE[st]}`}>
            {LI_STATUS_LABELS[st]} · {counts[st]}
          </button>
        ))}
      </div>
      <div className="overflow-x-auto max-h-[640px] overflow-y-auto">
        <table className="w-full text-sm">
          <thead className="text-xs text-gray-400 sticky top-0 bg-white z-10">
            <tr>
              <th className="py-2 pr-2 w-6"><input type="checkbox" className="rounded" checked={rows.length > 0 && rows.every((r) => selected.has(r.l.id))}
                onChange={(e) => setSelected(e.target.checked ? new Set(rows.map((r) => r.l.id)) : new Set())} /></th>
              <th className="py-2 pr-3 text-left font-medium">Lead</th>
              <th className="py-2 pr-3 text-left font-medium">Statut</th>
              <th className="py-2 pr-3 text-left font-medium">Dernière étape</th>
              <th className="py-2 pr-3 text-left font-medium">Prochaine étape</th>
              <th className="py-2 text-left font-medium">Message</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.slice(0, 500).map(({ l, last, next }) => (
              <Fragment key={l.id}>
                <tr className="cursor-pointer hover:bg-gray-50" onClick={() => setOpen(open === l.id ? null : l.id)}>
                  <td className="py-2 pr-2" onClick={(e) => e.stopPropagation()}>
                    <input type="checkbox" className="rounded" checked={selected.has(l.id)}
                      onChange={(e) => { const n = new Set(selected); e.target.checked ? n.add(l.id) : n.delete(l.id); setSelected(n); }} />
                  </td>
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-1 font-medium text-gray-900">
                      {open === l.id ? <ChevronDown className="w-3.5 h-3.5 text-gray-400" /> : <ChevronRight className="w-3.5 h-3.5 text-gray-400" />}
                      {fullName(l)}
                    </span>
                    <span className="block pl-5 text-xs text-gray-500">{[l.job_title, l.company].filter(Boolean).join(' · ')}</span>
                  </td>
                  <td className="py-2 pr-3"><span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${l.li_status ? STATUS_BADGE[l.li_status] : ''}`}>{l.li_status ? LI_STATUS_LABELS[l.li_status] : ''}</span></td>
                  <td className="py-2 pr-3 text-xs text-gray-600">{last.label}<span className="block text-gray-400">{fmtTime(last.at)}</span></td>
                  <td className="py-2 pr-3 text-xs text-gray-800">{next.label}</td>
                  <td className="py-2 whitespace-nowrap">
                    {l.li_variant && <span className={`text-[11px] px-1.5 py-0.5 rounded font-bold mr-1 ${VARIANT_BADGE[l.li_variant]}`}>{l.li_variant}</span>}
                    {l.li_question && <span className="text-[11px] text-gray-500">{QUESTION_LABELS[l.li_question as Question]}</span>}
                  </td>
                </tr>
                {open === l.id && <tr><td colSpan={6} className="p-0"><History id={l.id} l={l} /></td></tr>}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
