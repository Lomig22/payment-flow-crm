'use client';
import { AlertTriangle, CheckCircle2, ShieldAlert, Snowflake, MessageSquareOff, Hourglass, PhoneOff } from 'lucide-react';
import { FOLLOW_DAILY_LIMIT } from '@/lib/instagram';
import type { InstagramFunnelStats } from '@/types';

// ── Étapes des deux pistes ────────────────────────────────────────────
// Chaque étape (sauf la première) porte les seuils de conversion depuis l'étape
// précédente : ≥ good = vert, ≥ warn = orange, sinon rouge. `min` = effectif
// minimum de l'étape précédente pour juger (sinon « pas assez de données »).
type Step = {
  key: string; label: string; hint?: string;
  good?: number; warn?: number; min?: number;
  issue?: { title: string; why: string; icon: React.ElementType };
};

const FOLLOW_STEPS: Step[] = [
  { key: 'imported',      label: 'Comptes importés' },
  { key: 'followed',      label: 'Follows envoyés',  good: 0.8, warn: 0.5, min: 10,
    issue: { title: 'Stock « À follow » peu travaillé', why: `Les comptes importés ne sont pas follow. Prévoir un créneau follow quotidien (${FOLLOW_DAILY_LIMIT}/jour/compte max).`, icon: Hourglass } },
  { key: 'followed_back', label: 'Follow backs',     good: 0.25, warn: 0.10, min: 20,
    issue: { title: 'Peu de follow backs', why: 'Cibles trop froides ou profil peu attractif (photo, bio, contenu récent, preuve sociale). Revoir le ciblage des comptes importés et l’apparence du compte d’envoi.', icon: Snowflake } },
  { key: 'dm_sent',       label: 'DM envoyés',       good: 0.9, warn: 0.6, min: 10,
    issue: { title: 'Follow backs pas contactés', why: 'Des comptes ont follow en retour mais n’ont pas reçu de DM : la colonne « Follow back » attend. C’est la fenêtre la plus chaude, à traiter le jour même.', icon: Hourglass } },
  { key: 'opened',        label: 'DM ouverts',       good: 0.4, warn: 0.15, min: 20,
    issue: { title: 'Taux d’ouverture anormalement bas', why: 'Des DM personnalisés à des comptes qui viennent de follow en retour devraient être lus. Un taux très bas = forte suspicion de shadowban du compte d’envoi, ou DM classés en « demandes de message ». Voir le détail par compte ci-dessous.', icon: ShieldAlert } },
  { key: 'replied',       label: 'Réponses',         good: 0.3, warn: 0.15, min: 10,
    issue: { title: 'Lu, mais sans réponse', why: 'Le message est ouvert mais ne déclenche pas de réponse : accroche / script M1 et relances à retravailler.', icon: MessageSquareOff } },
  { key: 'rdv',           label: 'RDV',              good: 0.3, warn: 0.15, min: 5,
    issue: { title: 'Réponses mais peu de RDV', why: 'La conversation démarre mais ne se transforme pas : proposition d’appel trop tôt ou pas assez claire, closing DM à retravailler.', icon: PhoneOff } },
];

const DM_STEPS: Step[] = [
  { key: 'leads',   label: 'Leads à froid' },
  { key: 'dm_sent', label: 'DM envoyés',   good: 0.8, warn: 0.5, min: 10,
    issue: { title: 'Leads à froid en attente', why: 'Une partie des leads importés n’a jamais reçu de DM. Écouler la colonne « Lead ».', icon: Hourglass } },
  { key: 'opened',  label: 'DM ouverts',   good: 0.4, warn: 0.15, min: 20,
    issue: { title: 'Taux d’ouverture faible (DM à froid)', why: 'À froid, une part des DM tombe en « demandes de message ». Mais en dessous de 15 % avec des DM personnalisés, suspecter un shadowban du compte d’envoi — comparer les comptes ci-dessous.', icon: ShieldAlert } },
  { key: 'replied', label: 'Réponses',     good: 0.3, warn: 0.15, min: 10,
    issue: { title: 'Lu, mais sans réponse', why: 'Le message est ouvert mais ne déclenche pas de réponse : accroche / script M1 et relances à retravailler.', icon: MessageSquareOff } },
  { key: 'rdv',     label: 'RDV',          good: 0.3, warn: 0.15, min: 5,
    issue: { title: 'Réponses mais peu de RDV', why: 'Closing en DM à retravailler : proposition d’appel trop tôt ou pas assez claire.', icon: PhoneOff } },
];

type Level = 'good' | 'warn' | 'bad' | 'na';
type Rated = { step: Step; value: number; prev: number; rate: number | null; level: Level; severity: number };

function rate(steps: Step[], values: Record<string, number>): Rated[] {
  return steps.map((step, i) => {
    const value = Number(values[step.key] ?? 0);
    if (i === 0 || step.good == null) return { step, value, prev: 0, rate: null, level: 'na', severity: 0 };
    const prev = Number(values[steps[i - 1].key] ?? 0);
    const r = prev > 0 ? value / prev : null;
    if (r == null || prev < (step.min ?? 10)) return { step, value, prev, rate: r, level: 'na', severity: 0 };
    const level: Level = r >= step.good ? 'good' : r >= (step.warn ?? 0) ? 'warn' : 'bad';
    // Sévérité = à quel point on est sous le seuil d'alerte (1 = juste au seuil, 0 = zéro conversion)
    const severity = level === 'good' ? 0 : 1 - r / (step.warn ?? 1) + (level === 'bad' ? 1 : 0);
    return { step, value, prev, rate: r, level, severity };
  });
}

const LEVEL_CHIP: Record<Level, string> = {
  good: 'bg-emerald-100 text-emerald-700 border-emerald-200',
  warn: 'bg-amber-100 text-amber-700 border-amber-200',
  bad:  'bg-red-100 text-red-700 border-red-200',
  na:   'bg-gray-100 text-gray-400 border-gray-200',
};
const BAR_COLORS = ['bg-sky-400', 'bg-sky-500', 'bg-indigo-500', 'bg-violet-500', 'bg-fuchsia-500', 'bg-pink-500', 'bg-rose-500'];
const pct = (r: number | null) => (r == null ? '—' : `${Math.round(r * 100)} %`);

function Funnel({ title, subtitle, rated, worstKey }: { title: string; subtitle: string; rated: Rated[]; worstKey: string | null }) {
  const max = Math.max(1, ...rated.map((r) => r.value));
  const colorOffset = BAR_COLORS.length - rated.length;
  return (
    <div className="card p-5">
      <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      <p className="text-xs text-gray-400 mb-4">{subtitle}</p>
      <div className="space-y-1">
        {rated.map((r, i) => {
          const isWorst = worstKey === r.step.key;
          const width = Math.max(6, (r.value / max) * 100);
          return (
            <div key={r.step.key}>
              {i > 0 && (
                <div className="flex items-center gap-2 pl-36 py-0.5">
                  <span className="text-gray-300 text-xs">↓</span>
                  <span className={`text-[11px] font-semibold px-1.5 py-0.5 rounded border ${LEVEL_CHIP[r.level]}`}
                        title={r.level === 'na' ? 'Pas assez de données pour juger' : `Conversion depuis « ${rated[i - 1].step.label} »`}>
                    {pct(r.rate)}
                  </span>
                  {isWorst && (
                    <span className="text-[10px] font-bold uppercase tracking-wide text-red-600 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" /> Goulot d’étranglement
                    </span>
                  )}
                </div>
              )}
              <div className={`flex items-center gap-3 rounded-lg px-2 py-1 ${isWorst ? 'ring-2 ring-red-400 bg-red-50/60' : ''}`}>
                <span className="w-32 flex-shrink-0 text-xs font-medium text-gray-700 text-right">{r.step.label}</span>
                <div className="flex-1 h-7 bg-gray-100 rounded-md overflow-hidden">
                  <div className={`h-full ${BAR_COLORS[Math.max(0, i + colorOffset)]} transition-all flex items-center justify-end pr-2`}
                       style={{ width: `${width}%` }}>
                    <span className="text-[11px] font-bold text-white drop-shadow-sm">{r.value.toLocaleString('fr-FR')}</span>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function InstagramFunnel({ funnel }: { funnel: InstagramFunnelStats }) {
  const follow = rate(FOLLOW_STEPS, funnel.funnel_follow as unknown as Record<string, number>);
  const dm     = rate(DM_STEPS,     funnel.funnel_dm     as unknown as Record<string, number>);

  const issues = [...follow.map((r) => ({ ...r, track: 'Piste follow' })), ...dm.map((r) => ({ ...r, track: 'DM à froid' }))]
    .filter((r) => r.level === 'bad' || r.level === 'warn')
    .sort((a, b) => b.severity - a.severity);
  const worst = issues[0];
  const worstFollow = worst && worst.track === 'Piste follow' ? worst.step.key : null;
  const worstDm     = worst && worst.track === 'DM à froid'   ? worst.step.key : null;

  // Détail par compte : détection shadowban = ≥ 20 DM et < 15 % d'ouverture.
  const accounts = (funnel.by_account ?? []).filter((a) => a.dm_sent > 0 || a.follows > 0);
  const suspect  = accounts.filter((a) => a.dm_sent >= 20 && a.opened / a.dm_sent < 0.15);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Funnel title="Piste « follow d’abord »" subtitle="Follow → follow back → DM. Comptes importés en À follow, depuis le début."
                rated={follow} worstKey={worstFollow} />
        <Funnel title="Piste « DM à froid »" subtitle="DM direct sans follow. Leads importés en Lead, depuis le début."
                rated={dm} worstKey={worstDm} />
      </div>

      {/* Diagnostic */}
      <div className={`card p-5 border-l-4 ${worst?.level === 'bad' ? 'border-l-red-500' : worst ? 'border-l-amber-400' : 'border-l-emerald-500'}`}>
        <h3 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-2">
          {worst ? <AlertTriangle className={`w-4 h-4 ${worst.level === 'bad' ? 'text-red-500' : 'text-amber-500'}`} /> : <CheckCircle2 className="w-4 h-4 text-emerald-500" />}
          Où ça bloque
        </h3>
        {issues.length === 0 ? (
          <p className="text-sm text-gray-600">Aucun goulot détecté : toutes les conversions sont dans les seuils (ou pas encore assez de données pour juger).</p>
        ) : (
          <div className="space-y-3">
            {issues.slice(0, 4).map((r, i) => {
              const Icon = r.step.issue!.icon;
              return (
                <div key={`${r.track}-${r.step.key}`} className={`flex gap-3 p-3 rounded-lg ${r.level === 'bad' ? 'bg-red-50' : 'bg-amber-50'}`}>
                  <Icon className={`w-5 h-5 flex-shrink-0 mt-0.5 ${r.level === 'bad' ? 'text-red-500' : 'text-amber-500'}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900">
                      {i === 0 && <span className="text-[10px] uppercase tracking-wide text-red-600 mr-2">Priorité</span>}
                      {r.step.issue!.title}
                      <span className="ml-2 text-xs font-normal text-gray-500">
                        {r.track} · {pct(r.rate)} ({r.value}/{r.prev}) — attendu ≥ {pct(r.step.good ?? null)}
                      </span>
                    </p>
                    <p className="text-xs text-gray-600 mt-0.5">{r.step.issue!.why}</p>
                  </div>
                </div>
              );
            })}
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-3">
          Les ouvertures viennent de la case « Ouvert ? » cochée dans la liste Instagram (une réponse compte comme ouverte). Si elle n’est pas tenue à jour, le taux d’ouverture est sous-estimé.
        </p>
      </div>

      {/* Détail par compte d'envoi */}
      {accounts.length > 0 && (
        <div className="card p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Par compte d’envoi</h3>
          <p className="text-xs text-gray-400 mb-4">
            Un compte avec beaucoup de DM et presque aucune ouverture, alors que les autres ouvrent : shadowban probable → mettre ce compte en pause.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 border-b border-gray-100">
                <tr>
                  <th className="text-left py-2 font-medium">Compte</th>
                  <th className="text-right py-2 font-medium">Follows</th>
                  <th className="text-right py-2 font-medium">Follow backs</th>
                  <th className="text-right py-2 font-medium">DM</th>
                  <th className="text-right py-2 font-medium">Ouverts</th>
                  <th className="text-left py-2 pl-4 font-medium w-48">Taux d’ouverture</th>
                  <th className="text-right py-2 font-medium">Réponses</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const openRate = a.dm_sent > 0 ? a.opened / a.dm_sent : null;
                  const fbRate   = a.follows > 0 ? a.follow_backs / a.follows : null;
                  const isSuspect = suspect.includes(a);
                  const barColor = openRate == null ? 'bg-gray-300' : openRate >= 0.4 ? 'bg-emerald-500' : openRate >= 0.15 ? 'bg-amber-400' : 'bg-red-500';
                  return (
                    <tr key={a.account_id} className={`border-b border-gray-50 ${isSuspect ? 'bg-red-50/60' : ''}`}>
                      <td className="py-2 font-medium text-gray-800">
                        @{a.username.replace(/^@/, '')}
                        {isSuspect && (
                          <span className="ml-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase text-red-600">
                            <ShieldAlert className="w-3 h-3" /> shadowban ?
                          </span>
                        )}
                      </td>
                      <td className="py-2 text-right text-gray-600">{a.follows}</td>
                      <td className="py-2 text-right text-gray-600">{a.follow_backs}{fbRate != null && <span className="text-gray-400 text-xs"> ({pct(fbRate)})</span>}</td>
                      <td className="py-2 text-right text-gray-600">{a.dm_sent}</td>
                      <td className="py-2 text-right text-gray-600">{a.opened}</td>
                      <td className="py-2 pl-4">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                            <div className={`h-full ${barColor}`} style={{ width: `${Math.round((openRate ?? 0) * 100)}%` }} />
                          </div>
                          <span className="text-xs text-gray-600 w-10 text-right">{pct(openRate)}</span>
                        </div>
                      </td>
                      <td className="py-2 text-right text-gray-600">{a.replied}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-400 mt-3">
            Seuls les DM et follows faits depuis le CRM (clic sur le @) sont rattachés à un compte.
          </p>
        </div>
      )}
    </div>
  );
}
