'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import type { LinkedinLead, LinkedinSettings } from '@/lib/api';
import { VARIANT_BADGE, fullName } from './shared';
import { nextStep } from './LeadsTimeline';

// Pipeline LinkedIn : une colonne par étape de la séquence, les cartes triées par prochaine échéance

const COLUMNS: { key: string; title: string; statuses: string[]; cls: string }[] = [
  { key: 'queue',    title: 'En séquence',         statuses: ['to_invite'],                      cls: 'border-gray-300' },
  { key: 'invited',  title: 'Invitation envoyée',  statuses: ['invited'],                        cls: 'border-blue-400' },
  { key: 'accepted', title: 'Acceptée',            statuses: ['connected', 'to_validate', 'ready'], cls: 'border-sky-400' },
  { key: 'first',    title: '1er message envoyé',  statuses: ['first_sent'],                     cls: 'border-green-400' },
  { key: 'relances', title: 'Relances',            statuses: Array.from({ length: 16 }, (_, i) => `r${i + 1}_sent`), cls: 'border-teal-400' },
  { key: 'resume',   title: 'À reprendre',         statuses: ['to_resume'],                      cls: 'border-emerald-500' },
  { key: 'ended',    title: 'Terminé',             statuses: ['no_reply', 'expired', 'dnc', 'failed'], cls: 'border-gray-200' },
];
const SUB: Record<string, string> = {
  to_validate: 'à valider', ready: 'message prêt', connected: 'rédaction',
  ...Object.fromEntries(Array.from({ length: 16 }, (_, i) => [`r${i + 1}_sent`, `R${i + 1}`])),
  no_reply: 'sans réponse', expired: 'invitation expirée', dnc: 'ne plus contacter', failed: 'erreur',
};

// ── Filtre d'activité : ce qui s'est passé sur une période (jours de Paris) ──
type Activity = 'all' | 'invite' | 'accept' | 'message';
type Period = 'any' | 'today' | 'yesterday' | '7d' | 'custom';
const ACTIVITY: Record<Activity, string> = { all: 'Toute activité', invite: 'Invitations envoyées', accept: 'Acceptations', message: 'Messages envoyés' };
const PERIOD: Record<Period, string> = { any: 'Toute la période', today: "Aujourd'hui", yesterday: 'Hier', '7d': '7 derniers jours', custom: 'Dates…' };
const parisDay = (d: Date | string) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(d));
const shift = (days: number) => parisDay(new Date(Date.now() - days * 86_400_000));

// Dates de l'activité choisie pour un lead (premier message et dernier envoi pour les messages)
function activityDates(l: LinkedinLead, a: Activity): string[] {
  const inv = l.li_invited_at ? [l.li_invited_at] : [];
  const acc = l.li_connected_at ? [l.li_connected_at] : [];
  const msg = [l.li_dm_sent_at, l.li_last_sent_at].filter(Boolean) as string[];
  return a === 'invite' ? inv : a === 'accept' ? acc : a === 'message' ? msg : [...inv, ...acc, ...msg];
}

export default function LinkedinPipeline({ leads, settings }: { leads: LinkedinLead[]; settings: LinkedinSettings }) {
  const [activity, setActivity] = useState<Activity>('all');
  const [period, setPeriod] = useState<Period>('any');
  const [from, setFrom] = useState(shift(7));
  const [to, setTo] = useState(shift(0));

  const range: [string, string] | null = period === 'today' ? [shift(0), shift(0)] : period === 'yesterday' ? [shift(1), shift(1)]
    : period === '7d' ? [shift(6), shift(0)] : period === 'custom' ? [from, to] : null;
  const shown = useMemo(() => {
    if (!range && activity === 'all') return leads;
    return leads.filter((l) => {
      const dates = activityDates(l, activity);
      if (!range) return dates.length > 0;
      return dates.some((d) => { const day = parisDay(d); return day >= range[0] && day <= range[1]; });
    });
  }, [leads, activity, range?.[0], range?.[1]]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <select className="input w-auto py-1.5" value={activity} onChange={(e) => setActivity(e.target.value as Activity)}>
        {Object.entries(ACTIVITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <div className="flex gap-1 flex-wrap">
        {(Object.keys(PERIOD) as Period[]).map((p) => (
          <button key={p} onClick={() => setPeriod(p)}
            className={`px-3 py-1.5 rounded-full ${period === p ? 'bg-[#0a66c2] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{PERIOD[p]}</button>
        ))}
      </div>
      {period === 'custom' && (
        <span className="flex items-center gap-1.5 text-gray-600">
          du <input type="date" className="input w-auto py-1" value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
          au <input type="date" className="input w-auto py-1" value={to} min={from} onChange={(e) => setTo(e.target.value)} />
        </span>
      )}
      {(range || activity !== 'all') && <span className="text-gray-500"><b className="text-gray-900">{shown.length}</b> lead{shown.length > 1 ? 's' : ''}</span>}
    </div>
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const items = shown.filter((l) => col.statuses.includes(l.li_status ?? ''))
          .map((l) => ({ l, next: nextStep(l, settings) }))
          .sort((a, b) => (a.next.at ? new Date(a.next.at).getTime() : Infinity) - (b.next.at ? new Date(b.next.at).getTime() : Infinity));
        return (
          <div key={col.key} className={`flex-shrink-0 w-64 bg-gray-50 rounded-lg border-t-4 ${col.cls}`}>
            <div className="px-3 py-2 flex items-center justify-between">
              <p className="text-sm font-semibold text-gray-800">{col.title}</p>
              <span className="text-xs text-gray-500 tabular-nums">{items.length}</span>
            </div>
            <div className="px-2 pb-2 space-y-2 max-h-[70vh] overflow-y-auto">
              {items.map(({ l, next }) => (
                <Link key={l.id} href={`/leads/${l.id}`} className="block bg-white rounded-md border border-gray-100 p-2.5 hover:border-gray-300 transition-colors">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-gray-900 truncate flex-1">{fullName(l)}</p>
                    {l.li_variant && <span className={`text-[10px] px-1 rounded font-bold ${VARIANT_BADGE[l.li_variant]}`}>{l.li_variant}</span>}
                  </div>
                  {(l.job_title || l.company) && <p className="text-xs text-gray-500 truncate">{[l.job_title, l.company].filter(Boolean).join(' · ')}</p>}
                  {SUB[l.li_status ?? ''] && <p className="mt-1 text-[11px] text-gray-500">{SUB[l.li_status ?? '']}</p>}
                  {next.label && <p className="mt-1 text-[11px] text-[#0a66c2]">{next.label}</p>}
                </Link>
              ))}
              {!items.length && <p className="px-1 py-3 text-xs text-gray-400">Aucun lead</p>}
            </div>
          </div>
        );
      })}
    </div>
    </div>
  );
}
