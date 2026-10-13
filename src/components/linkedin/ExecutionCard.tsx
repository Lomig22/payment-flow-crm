'use client';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Power, Activity, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinApi, type LinkedinExecution, type LinkedinSettings } from '@/lib/api';
import { fmtTime, apiError } from './shared';

// Carte « Exécution » : actif / en pause / arrêté (avec la raison), plafonds du jour et de la semaine,
// phase de montée en charge, et l'interrupteur de la séquence (seul Lomig l'active)

const STATE: Record<LinkedinExecution['state'], { label: string; cls: string }> = {
  active:  { label: 'Actif',         cls: 'bg-green-100 text-green-700' },
  outside: { label: 'En pause',      cls: 'bg-gray-100 text-gray-600' },
  paused:  { label: 'En pause',      cls: 'bg-amber-100 text-amber-800' },
  stopped: { label: 'Bloqué',        cls: 'bg-red-100 text-red-700' },
  cooldown: { label: 'Cooldown',     cls: 'bg-orange-100 text-orange-800' },
};
const hm = (m: number) => `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')}`;
// Le worker interroge le CRM toutes les 2 min : au-delà de 10 min sans nouvelles, il ne tourne plus
const WORKER_ALIVE_MS = 10 * 60_000;

function Gauge({ label, value, max, hint }: { label: string; value: number; max: number; hint?: string }) {
  const ratio = max ? Math.min(1, value / max) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span className="tabular-nums font-semibold text-gray-900">{value} / {max}</span>
      </div>
      <div className="mt-1 h-1.5 rounded-full bg-gray-100 overflow-hidden">
        <div className={`h-full ${ratio >= 1 ? 'bg-amber-500' : 'bg-[#0a66c2]'}`} style={{ width: `${ratio * 100}%` }} />
      </div>
      {hint && <p className="mt-0.5 text-[11px] text-gray-400">{hint}</p>}
    </div>
  );
}

export default function ExecutionCard({ execution: x, settings }: { execution: LinkedinExecution; settings: LinkedinSettings }) {
  const qc = useQueryClient();
  const toggle = useMutation({
    mutationFn: (enabled: boolean) => linkedinApi.saveSettings({ enabled }),
    onSuccess: (_, enabled) => { toast.success(enabled ? 'Séquence activée' : 'Séquence en pause'); qc.invalidateQueries({ queryKey: ['linkedin'] }); },
    onError: (e) => toast.error(apiError(e)),
  });
  const workerAlive = x.worker_seen_at && Date.now() - new Date(x.worker_seen_at).getTime() < WORKER_ALIVE_MS;
  const st = STATE[x.state];

  const activate = () => {
    const msg = settings.stop_reason
      ? `La séquence a été arrêtée : ${settings.stop_reason}.\n\nAvez-vous vérifié le compte LinkedIn (écran du VPS) ? La réactiver relance les invitations et les messages.`
      : 'Activer la séquence ? Les invitations et les messages partiront vers de vrais prospects, dans la fenêtre d\'envoi.';
    if (window.confirm(msg)) toggle.mutate(true);
  };

  return (
    <div className="card p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Activity className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Exécution</p>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span>
        {x.reason && <span className="text-xs text-gray-500">{x.reason}</span>}
        <button onClick={() => (settings.enabled ? toggle.mutate(false) : activate())} disabled={toggle.isPending}
          className={`ml-auto btn-sm ${settings.enabled ? 'btn-secondary' : 'btn-primary'}`}>
          <Power className="w-3.5 h-3.5" /> {settings.enabled ? 'Mettre en pause' : 'Activer la séquence'}
        </button>
      </div>

      {x.state === 'stopped' && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 flex gap-2">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Compte bloqué le {fmtTime(settings.stopped_at)} : {settings.stop_reason}. Rien ne repart automatiquement :
            réglez le problème sur l&apos;écran du VPS, puis cliquez sur « Débloquer » dans la carte Montée en charge.
          </span>
        </div>
      )}

      <div className="grid sm:grid-cols-3 gap-4">
        <Gauge label="Invitations aujourd'hui" value={x.invites_today} max={x.invites_per_day}
          hint={`Palier ${settings.tier} / ${settings.tiers?.length ?? 4} de la montée en charge`} />
        <Gauge label="Invitations sur 7 jours" value={x.invites_week} max={x.weekly_cap} hint="Plafond absolu, 7 jours glissants" />
        <Gauge label="Messages aujourd'hui" value={x.messages_today} max={x.messages_per_day} hint="Premiers messages et relances" />
      </div>

      <p className="text-xs text-gray-500">
        Fenêtre : {settings.weekdays_only ? 'lundi au vendredi' : 'tous les jours'}, {hm(settings.day_start_min)} – {hm(settings.day_end_min)}, pause {hm(settings.lunch_start_min)} – {hm(settings.lunch_end_min)} (Paris).
        {settings.invite_gap_min} à {settings.invite_gap_max} min entre deux invitations.
        {settings.enabled && x.next_action_at && new Date(x.next_action_at) > new Date() && <> Prochaine action du robot vers {new Date(x.next_action_at).toLocaleTimeString('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' })}.</>}
        {' '}Worker du VPS : <span className={workerAlive ? 'text-green-700' : 'text-red-600'}>{workerAlive ? 'en ligne' : 'sans nouvelles'}</span>
        {' '}(dernier contact {fmtTime(x.worker_seen_at)}).
      </p>
    </div>
  );
}
