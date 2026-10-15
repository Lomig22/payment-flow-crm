'use client';
import { relancesOf, stageOfStatus } from '@/lib/linkedinSequence';
import type { LinkedinLead, LinkedinSettings } from '@/lib/api';
import { STAGE_LABELS } from '@/lib/linkedinLabels';
import { fullName } from './shared';

// Aujourd'hui : ce qui a été fait (invitations, acceptations, messages, réponses) et ce qui est
// prévu d'ici la fin de la journée, nom par nom

const isToday = (iso: string | null | undefined) => {
  if (!iso) return false;
  const key = (d: Date) => d.toLocaleDateString('fr-CA', { timeZone: 'Europe/Paris' });
  return key(new Date(iso)) === key(new Date());
};
const hm = (iso: string) => new Date(iso).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' });

function Block({ title, items, empty }: { title: string; items: { key: string; text: string; at?: string | null }[]; empty: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase mb-1.5">{title} ({items.length})</p>
      {items.length === 0 ? <p className="text-xs text-gray-400">{empty}</p> : (
        <ul className="space-y-1 text-sm max-h-48 overflow-y-auto">
          {items.map((i) => (
            <li key={i.key} className="flex gap-2">
              <span className="text-xs text-gray-400 tabular-nums w-11 flex-shrink-0 pt-0.5">{i.at ? hm(i.at) : ''}</span>
              <span className="text-gray-800">{i.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function TodayCard({ leads, settings }: { leads: LinkedinLead[]; settings: LinkedinSettings }) {
  const done = [
    ...leads.filter((l) => isToday(l.li_invited_at)).map((l) => ({ key: `i${l.id}`, at: l.li_invited_at, text: `Invitation envoyée à ${fullName(l)}` })),
    ...leads.filter((l) => isToday(l.li_connected_at)).map((l) => ({ key: `c${l.id}`, at: l.li_connected_at, text: `${fullName(l)} a accepté` })),
    ...leads.filter((l) => isToday(l.li_last_sent_at)).map((l) => ({ key: `m${l.id}`, at: l.li_last_sent_at, text: `${STAGE_LABELS[l.li_last_kind ?? 'first']} envoyé à ${fullName(l)}` })),
    ...leads.filter((l) => isToday(l.li_replied_at)).map((l) => ({ key: `r${l.id}`, at: l.li_replied_at, text: `${fullName(l)} a répondu` })),
  ].sort((a, b) => String(b.at).localeCompare(String(a.at)));

  const endOfDay = new Date(); endOfDay.setHours(23, 59, 59);
  const dueToday = (iso: string | null) => !!iso && new Date(iso) <= endOfDay;
  const planned = settings.enabled ? [
    ...leads.filter((l) => l.li_status === 'to_invite' && isToday(l.invite_forecast)).map((l) => ({ key: `pi${l.id}`, text: `Invitation à ${fullName(l)}` })),
    ...leads.filter((l) => l.li_status === 'connected').map((l) => ({ key: `pc${l.id}`, text: `Visite du profil de ${fullName(l)} et rédaction du message` })),
    ...leads.filter((l) => l.li_status === 'ready' && dueToday(l.li_due_at)).map((l) => ({ key: `pr${l.id}`, text: `Message à ${fullName(l)}` })),
    ...leads.filter((l) => { const k = stageOfStatus(l.li_status); return k >= 0 && k < relancesOf(settings).length && dueToday(l.li_due_at); }).map((l) => ({ key: `pf${l.id}`, text: `Relance de ${fullName(l)}` })),
  ] : [];
  const toValidate = leads.filter((l) => l.li_status === 'to_validate').length;

  return (
    <div className="card p-5 space-y-3">
      <p className="text-sm font-semibold text-gray-900">Aujourd&apos;hui</p>
      <div className="grid md:grid-cols-2 gap-5">
        <Block title="Fait" items={done} empty="Rien pour l'instant." />
        <Block title="Prévu d'ici ce soir" items={planned}
          empty={settings.enabled ? 'Plus rien de prévu aujourd\'hui.' : 'Séquence en pause : rien de prévu.'} />
      </div>
      {toValidate > 0 && <p className="text-xs text-amber-700">{toValidate} message(s) attendent votre validation avant de partir.</p>}
      <p className="text-[11px] text-gray-400">
        Les invitations partent une par une, à {settings.invite_gap_min}–{settings.invite_gap_max} min d&apos;intervalle, en 2 ou 3 sessions entre 9 h et 18 h 30 (pause déjeuner).
        La prévision se décale si une action échoue ou si la séquence est mise en pause.
      </p>
    </div>
  );
}
