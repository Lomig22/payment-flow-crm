'use client';
import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { TrendingUp, ShieldAlert, Unlock, ArrowDownToLine, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinApi, type LinkedinRamp, type LinkedinRates } from '@/lib/api';
import { SECTORS } from '@/lib/linkedinLabels';
import { fmtTime, apiError } from './shared';

// Montée en charge intelligente (sprint46) : palier, plan du jour, plafonds, invitations en attente,
// taux d'acceptation / de réponse par variante et par secteur, état du compte et historique,
// contrôles manuels (palier forcé vers le bas, déblocage)

const STATE: Record<LinkedinRamp['account_state'], { label: string; cls: string }> = {
  active:   { label: 'ACTIF',    cls: 'bg-green-100 text-green-700' },
  cooldown: { label: 'COOLDOWN', cls: 'bg-orange-100 text-orange-800' },
  blocked:  { label: 'BLOQUÉ',   cls: 'bg-red-100 text-red-700' },
};
const EVENT_LABEL: Record<string, string> = {
  tier_up: 'Palier ↑', tier_down: 'Palier ↓', tier_forced: 'Palier forcé', cooldown: 'Cooldown', blocked: 'Blocage',
  resumed: 'Reprise', unblocked: 'Déblocage', pending_suspend: 'Envois suspendus', note_unavailable: 'Notes indisponibles',
};
const VARIANT_LABEL: Record<string, string> = { no_note: 'Sans note', note: 'Avec note' };
const hm = (m: number) => `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`;
const pct = (r: { rate: number | null; sent: number }) => (r.rate == null ? '—' : `${Math.round(r.rate * 100)} %`);

function Bar({ label, value, max, warn }: { label: string; value: number; max: number; warn?: number }) {
  const ratio = max ? Math.min(1, value / max) : 0;
  const color = value >= max ? 'bg-red-500' : warn && value >= warn ? 'bg-amber-500' : 'bg-[#0a66c2]';
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500"><span>{label}</span><span className="tabular-nums font-semibold text-gray-900">{value} / {max}</span></div>
      <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden"><div className={`h-full ${color}`} style={{ width: `${ratio * 100}%` }} /></div>
    </div>
  );
}

function RatesTable({ title, rows }: { title: string; rows: [string, LinkedinRates][] }) {
  if (!rows.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase mb-1">{title}</p>
      <table className="w-full text-xs tabular-nums">
        <thead className="text-gray-400">
          <tr><th className="text-left font-medium py-1" /><th className="text-right font-medium">Accept. 7 j</th><th className="text-right font-medium">Accept. 30 j</th><th className="text-right font-medium">Réponse aux DM</th></tr>
        </thead>
        <tbody className="divide-y divide-gray-50">
          {rows.map(([k, r]) => (
            <tr key={k}>
              <td className="py-1 text-gray-700">{k}</td>
              <td className="text-right">{pct(r.accept_7)} <span className="text-gray-400">({r.accept_7.accepted}/{r.accept_7.sent})</span></td>
              <td className="text-right">{pct(r.accept_30)} <span className="text-gray-400">({r.accept_30.accepted}/{r.accept_30.sent})</span></td>
              <td className="text-right">{r.reply.sent ? `${Math.round((r.reply.replied / r.reply.sent) * 100)} %` : '—'} <span className="text-gray-400">({r.reply.replied}/{r.reply.sent})</span></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RampCard({ ramp: r }: { ramp: LinkedinRamp }) {
  const qc = useQueryClient();
  const [forced, setForced] = useState(Math.max(1, r.tier - 1));
  const done = (msg: string) => { toast.success(msg); qc.invalidateQueries({ queryKey: ['linkedin'] }); };
  const force = useMutation({ mutationFn: (t: number) => linkedinApi.forceTier(t), onSuccess: () => done('Palier abaissé'), onError: (e) => toast.error(apiError(e)) });
  const unblock = useMutation({ mutationFn: () => linkedinApi.unblock(), onSuccess: () => done('Compte débloqué'), onError: (e) => toast.error(apiError(e)) });
  const tier = r.tiers[r.tier - 1];
  const st = STATE[r.account_state];
  const ipChanges = new Set(r.worker.ips.map((x) => x.ip)).size;

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <TrendingUp className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Montée en charge</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${st.cls}`}>{st.label}</span>
        {r.account_state === 'cooldown' && <span className="text-xs text-orange-700">reprise automatique le {fmtTime(r.cooldown_until)}</span>}
        {r.account_state === 'blocked' && (
          <button className="ml-auto btn-primary btn-sm" disabled={unblock.isPending}
            onClick={() => window.confirm('Le captcha, la vérification ou la connexion ont-ils été réglés sur l\'écran du VPS ? Le robot reprendra ses actions.') && unblock.mutate()}>
            <Unlock className="w-3.5 h-3.5" /> Débloquer
          </button>
        )}
      </div>

      {/* Sécurité : IP de sortie, proxy */}
      {!r.worker.proxy && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          <span>Aucun proxy configuré : la session LinkedIn passe par l&apos;IP fixe du VPS{r.worker.ip ? ` (${r.worker.ip})` : ''}. Une seule IP, stable.</span>
        </div>
      )}
      {ipChanges > 1 && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-2.5 text-xs text-red-800 flex gap-2">
          <ShieldAlert className="w-4 h-4 flex-shrink-0" />
          <span>{ipChanges} IP différentes vues sur 7 jours ({r.worker.ips.map((x) => x.ip).join(', ')}) : la session devrait toujours sortir par la même IP.</span>
        </div>
      )}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div>
          <p className="text-xs text-gray-500">Palier actuel</p>
          <p className="text-xl font-bold text-gray-900">{r.tier} / {r.tiers.length} <span className="text-sm font-normal text-gray-500">({tier.min === tier.max ? tier.min : `${tier.min}–${tier.max}`} / jour)</span></p>
          <p className="text-[11px] text-gray-400">depuis le {fmtTime(r.tier_since)}{r.tier_reason ? ` · ${r.tier_reason}` : ''}</p>
        </div>
        <Bar label="Envoyées aujourd'hui" value={r.invites_today} max={r.plan?.target ?? 0} />
        <Bar label="Sur 7 jours glissants" value={r.invites_week} max={r.weekly_cap} warn={r.weekly_cap * 0.9} />
        <div>
          <Bar label="Invitations en attente (LinkedIn)" value={r.pending_count ?? 0} max={r.pending_cap} warn={r.pending_suspend} />
          <p className="mt-0.5 text-[11px] text-gray-400">
            {r.pending_count == null ? 'pas encore relevé' : `relevé le ${fmtTime(r.pending_count_at)}`} · envois suspendus à {r.pending_suspend}
          </p>
        </div>
      </div>

      {r.plan && (
        <p className="text-xs text-gray-600">
          Plan du jour : <span className="font-semibold">{r.plan.target} invitations</span> en {r.plan.sessions.length} sessions
          {' '}({r.plan.sessions.map((x) => `${hm(x.start)}–${hm(x.end)} : ${x.count}`).join(' · ')}), 3 à 12 min entre deux invitations.
          {r.previsited > 0 && ` ${r.previsited} profil(s) déjà visité(s) avant leur invitation.`}
          {r.open_profiles > 0 && ` ${r.open_profiles} Open Profile repéré(s).`}
        </p>
      )}

      <div className="grid lg:grid-cols-2 gap-5">
        <div className="space-y-4">
          <RatesTable title="Ensemble" rows={[['Toutes les invitations', r.overall]]} />
          <p className="text-[11px] text-gray-400">
            Palier : monte si taux ≥ seuil sur les invitations de 7 à 21 jours ({pct(r.overall.accept_mature)} sur {r.overall.accept_mature.sent} invitations), redescend sous le seuil bas.
          </p>
          <RatesTable title="Par variante d'invitation" rows={Object.entries(r.by_variant).map(([k, v]) => [VARIANT_LABEL[k] ?? k, v])} />
        </div>
        <RatesTable title="Par secteur" rows={Object.entries(r.by_sector).map(([k, v]) => [SECTORS[k] ?? k, v])} />
      </div>

      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="text-gray-600">Forcer un palier inférieur :</span>
        <select className="input py-1 w-auto" value={forced} onChange={(e) => setForced(Number(e.target.value))} disabled={r.tier <= 1}>
          {Array.from({ length: Math.max(0, r.tier - 1) }, (_, i) => i + 1).map((t) => <option key={t} value={t}>Palier {t}</option>)}
        </select>
        <button className="btn-secondary btn-sm" disabled={r.tier <= 1 || force.isPending}
          onClick={() => window.confirm(`Passer au palier ${forced} ? Il faudra de nouveau ${'7'} jours sans incident pour remonter.`) && force.mutate(forced)}>
          <ArrowDownToLine className="w-3.5 h-3.5" /> Appliquer
        </button>
      </div>

      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase mb-1">Historique du compte</p>
        {r.events.length === 0 ? <p className="text-xs text-gray-400">Aucun événement.</p> : (
          <div className="divide-y divide-gray-50 max-h-56 overflow-y-auto">
            {r.events.map((e) => (
              <div key={e.id} className="py-1.5 flex gap-3 text-xs">
                <span className="text-gray-400 w-28 tabular-nums flex-shrink-0">{fmtTime(e.created_at)}</span>
                <span className="w-28 flex-shrink-0 font-medium text-gray-700">{EVENT_LABEL[e.type] ?? e.type}</span>
                <span className="text-gray-600">{e.detail}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
