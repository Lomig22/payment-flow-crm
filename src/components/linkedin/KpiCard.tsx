'use client';
import { useState } from 'react';
import type { LinkedinLead } from '@/lib/api';

// Taux clés LinkedIn, par cohorte : invitations envoyées sur la période → acceptées ; premiers
// messages envoyés sur la période → lus (« Vu », si LinkedIn l'affiche) et ayant obtenu une réponse.

type Range = '7' | '30' | 'all';
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : '—');

export default function KpiCard({ leads }: { leads: LinkedinLead[] }) {
  const [range, setRange] = useState<Range>('7');
  const since = range === 'all' ? 0 : Date.now() - Number(range) * 86_400_000;
  const inRange = (iso: string | null | undefined) => !!iso && Date.parse(iso) >= since;
  const invited = leads.filter((l) => inRange(l.li_invited_at));
  const accepted = invited.filter((l) => l.li_connected_at);
  const messaged = leads.filter((l) => inRange(l.li_dm_sent_at));
  const seen = messaged.filter((l) => l.li_seen_at || l.li_replied_at);   // une réponse vaut lecture
  const replied = messaged.filter((l) => l.li_replied_at);
  const tiles = [
    { label: 'Taux de réponse', value: pct(replied.length, messaged.length), sub: `${replied.length} réponse(s) / ${messaged.length} message(s)`, main: true },
    { label: 'Taux d\'ouverture (« Vu »)', value: pct(seen.length, messaged.length), sub: `${seen.length} lu(s) / ${messaged.length} message(s)`, main: true },
    { label: 'Taux d\'acceptation', value: pct(accepted.length, invited.length), sub: `${accepted.length} / ${invited.length} invitation(s)` },
  ];
  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <p className="font-semibold text-gray-900">Taux clés</p>
        <div className="flex gap-1 ml-auto">
          {(['7', '30', 'all'] as Range[]).map((r) => (
            <button key={r} onClick={() => setRange(r)} className={`px-3 py-1 rounded-full text-sm ${range === r ? 'bg-[#0a66c2] text-white' : 'bg-gray-100 text-gray-600'}`}>
              {r === 'all' ? 'Depuis le début' : `${r} jours`}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {tiles.map((t) => (
          <div key={t.label} className={`rounded-lg p-4 ${t.main ? 'bg-[#0a66c2]/5 border border-[#0a66c2]/20' : 'bg-gray-50'}`}>
            <p className="text-xs text-gray-500">{t.label}</p>
            <p className="text-2xl font-bold text-gray-900 tabular-nums">{t.value}</p>
            <p className="text-xs text-gray-500">{t.sub}</p>
          </div>
        ))}
      </div>
      <p className="text-[11px] text-gray-400">Le « Vu » n&apos;est relevé que si l&apos;accusé de lecture est activé chez vous et chez le prospect : le taux d&apos;ouverture LinkedIn est donc un minimum.</p>
    </div>
  );
}
