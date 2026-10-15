'use client';
import { useMemo, useState } from 'react';
import type { LinkedinLead } from '@/lib/api';
import { SECTORS, QUESTION_LABELS, STAGE_LABELS, type Question } from '@/lib/linkedinLabels';
import { VARIANT_BADGE, pct } from './shared';

// Indicateurs, filtrables par période et par secteur. Chaque taux est calculé sur la cohorte de la
// période : invitations envoyées dans la période → acceptées ; premiers messages envoyés dans la
// période → réponses (quel que soit le message qui l'a déclenchée).

const PERIODS = [
  { key: '7', label: '7 jours', days: 7 }, { key: '30', label: '30 jours', days: 30 },
  { key: '90', label: '90 jours', days: 90 }, { key: 'all', label: 'Depuis le début', days: 0 },
];
const VARIANTS = ['A', 'B', 'C'];
const QUESTIONS: Question[] = ['cout_client', 'regularite'];
// Étapes de réponse : premier message, R1 … R16, relance post (seules celles qui ont des réponses s'affichent au-delà de R3)
const ALL_STAGES = ['first', ...Array.from({ length: 16 }, (_, i) => `r${i + 1}`), 'post'];

function Stat({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-xl font-bold text-gray-900 tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  );
}

const Rate = ({ n, d }: { n: number; d: number }) => (
  <span className="tabular-nums">
    <span className="font-semibold text-gray-900">{pct(n, d)}</span>
    <span className="text-[11px] text-gray-400"> {n}/{d}</span>
  </span>
);

export default function StatsPanel({ leads }: { leads: LinkedinLead[] }) {
  const [period, setPeriod] = useState('30');
  const [sector, setSector] = useState('all');

  const s = useMemo(() => {
    const days = PERIODS.find((p) => p.key === period)!.days;
    const since = days ? Date.now() - days * 86_400_000 : 0;
    const inPeriod = (iso: string | null) => !!iso && new Date(iso).getTime() >= since;
    const pool = leads.filter((l) => sector === 'all' || l.li_sector === sector);
    const invited = pool.filter((l) => inPeriod(l.li_invited_at));
    const sent = pool.filter((l) => inPeriod(l.li_dm_sent_at));
    const replied = (ls: LinkedinLead[]) => ls.filter((l) => l.li_replied_at && l.li_replied_stage).length;
    const by = (f: (l: LinkedinLead) => boolean) => { const g = sent.filter(f); return { n: replied(g), d: g.length }; };
    const repliedLeads = sent.filter((l) => l.li_replied_at && l.li_replied_stage);
    return {
      invited: invited.length,
      accepted: invited.filter((l) => l.li_connected_at).length,
      sent: sent.length,
      replied: repliedLeads.length,
      variants: Object.fromEntries(VARIANTS.map((v) => [v, by((l) => l.li_variant === v)])),
      questions: Object.fromEntries(QUESTIONS.map((q) => [q, by((l) => l.li_question === q)])),
      matrix: Object.fromEntries(VARIANTS.map((v) => [v, Object.fromEntries(QUESTIONS.map((q) => [q, by((l) => l.li_variant === v && l.li_question === q)]))])),
      stages: Object.fromEntries(ALL_STAGES.map((st) => [st, repliedLeads.filter((l) => l.li_replied_stage === st).length])),
      untreated: leads.filter((l) => l.li_status === 'to_resume' && !l.li_handled_at).length,
    };
  }, [leads, period, sector]);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-gray-900">Indicateurs</p>
        <div className="ml-auto flex flex-wrap gap-2">
          <select className="input py-1 text-sm w-auto" value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
          </select>
          <select className="input py-1 text-sm w-auto" value={sector} onChange={(e) => setSector(e.target.value)}>
            <option value="all">Tous les secteurs</option>
            {Object.entries(SECTORS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <Stat label="Invitations envoyées" value={s.invited} />
        <Stat label="Taux d'acceptation" value={pct(s.accepted, s.invited)} sub={`${s.accepted} acceptée(s)`} />
        <Stat label="Premiers messages" value={s.sent} />
        <Stat label="Taux de réponse" value={pct(s.replied, s.sent)} sub={`${s.replied} réponse(s)`} />
        <Stat label="À reprendre non traités" value={s.untreated} />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 text-sm">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Réponse par variante × question</p>
          <table className="w-full">
            <thead className="text-xs text-gray-400">
              <tr><th className="text-left font-medium py-1" />{QUESTIONS.map((q) => <th key={q} className="text-right font-medium py-1">{QUESTION_LABELS[q]}</th>)}<th className="text-right font-medium py-1">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {VARIANTS.map((v) => (
                <tr key={v}>
                  <td className="py-1.5"><span className={`px-1.5 py-0.5 rounded text-xs font-bold ${VARIANT_BADGE[v]}`}>{v}</span></td>
                  {QUESTIONS.map((q) => <td key={q} className="py-1.5 text-right"><Rate {...s.matrix[v][q]} /></td>)}
                  <td className="py-1.5 text-right"><Rate {...s.variants[v]} /></td>
                </tr>
              ))}
              <tr>
                <td className="py-1.5 text-xs text-gray-500">Total</td>
                {QUESTIONS.map((q) => <td key={q} className="py-1.5 text-right"><Rate {...s.questions[q]} /></td>)}
                <td className="py-1.5 text-right"><Rate n={s.replied} d={s.sent} /></td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-[11px] text-gray-400">Attendre une trentaine de messages par case avant de conclure.</p>
        </div>

        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Message qui a déclenché la réponse</p>
          <ul className="space-y-1">
            {ALL_STAGES.filter((st) => ['first', 'r1', 'r2', 'r3', 'post'].includes(st) || s.stages[st]).map((st) => (
              <li key={st} className="flex items-center gap-2">
                <span className="w-32 text-gray-600">{STAGE_LABELS[st]}</span>
                <div className="flex-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
                  <div className="h-full bg-[#0a66c2]" style={{ width: `${s.replied ? (s.stages[st] / s.replied) * 100 : 0}%` }} />
                </div>
                <span className="w-8 text-right tabular-nums text-gray-900">{s.stages[st]}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="text-xs text-gray-500 space-y-1">
          <p className="font-semibold uppercase">Lecture</p>
          <p>Variantes : A = post récent, B = fait du profil, C = modèle. Questions : Q1 coût d&apos;un nouveau client, Q2 régularité des clients (en alternance).</p>
          <p>Les taux portent sur les leads dont l&apos;invitation, ou le premier message, est partie dans la période choisie.</p>
        </div>
      </div>
    </div>
  );
}
