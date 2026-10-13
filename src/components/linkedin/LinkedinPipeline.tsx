'use client';
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
  { key: 'relances', title: 'Relances',            statuses: ['r1_sent', 'r2_sent', 'r3_sent'],  cls: 'border-teal-400' },
  { key: 'resume',   title: 'À reprendre',         statuses: ['to_resume'],                      cls: 'border-emerald-500' },
  { key: 'ended',    title: 'Terminé',             statuses: ['no_reply', 'expired', 'dnc', 'failed'], cls: 'border-gray-200' },
];
const SUB: Record<string, string> = {
  to_validate: 'à valider', ready: 'message prêt', connected: 'rédaction', r1_sent: 'R1', r2_sent: 'R2', r3_sent: 'R3',
  no_reply: 'sans réponse', expired: 'invitation expirée', dnc: 'ne plus contacter', failed: 'erreur',
};

export default function LinkedinPipeline({ leads, settings }: { leads: LinkedinLead[]; settings: LinkedinSettings }) {
  return (
    <div className="flex gap-3 overflow-x-auto pb-2">
      {COLUMNS.map((col) => {
        const items = leads.filter((l) => col.statuses.includes(l.li_status ?? ''))
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
  );
}
