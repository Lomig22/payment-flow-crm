'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2, TrendingUp } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinApi, type LinkedinSettings } from '@/lib/api';
import { SECTORS } from '@/lib/linkedinLabels';
import { apiError } from './shared';

// Réglages de la montée en charge (sprint46) : tout est en base, modifiable sans redéploiement

const toHM = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const fromHM = (v: string) => { const [h, m] = v.split(':').map(Number); return h * 60 + (m || 0); };

type Num = 'promote_min_days' | 'promote_rate' | 'promote_rate_last' | 'demote_rate' | 'rate_min_sample' | 'weekly_invite_cap'
  | 'last_tier_bonus_pct' | 'volume_jitter_pct' | 'invite_gap_min' | 'invite_gap_max' | 'sessions_min' | 'sessions_max'
  | 'cooldown_days' | 'cooldown_tier_drop' | 'error_streak_max' | 'pending_cap' | 'pending_suspend' | 'invite_expiry_days'
  | 'reinvite_block_days' | 'note_split_pct';
type Time = 'day_start_min' | 'day_end_min' | 'lunch_start_min' | 'lunch_end_min';

export default function RampSettingsCard({ settings }: { settings: LinkedinSettings }) {
  const qc = useQueryClient();
  const [f, setF] = useState(settings);
  useEffect(() => { setF(settings); }, [settings]);
  const save = useMutation({
    mutationFn: (d: Partial<LinkedinSettings>) => linkedinApi.saveSettings(d),
    onSuccess: () => { toast.success('Réglages de montée en charge enregistrés'); qc.invalidateQueries({ queryKey: ['linkedin'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  const num = (k: Num, label: string, suffix?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" className="input py-1.5" value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />
        {suffix && <span className="text-xs text-gray-500 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  );
  const time = (k: Time, label: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <input type="time" className="input py-1.5" value={toHM(f[k])} onChange={(e) => setF({ ...f, [k]: fromHM(e.target.value) })} />
    </label>
  );
  const tiers = f.tiers ?? [];
  const setTier = (i: number, k: 'min' | 'max', v: number) => setF({ ...f, tiers: tiers.map((t, j) => (j === i ? { ...t, [k]: v } : t)) });
  const notes = f.note_templates ?? {};
  const setNote = (k: string, v: string) => setF({ ...f, note_templates: { ...notes, [k]: v } });

  const submit = () => {
    const note_templates = Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
    save.mutate({
      tiers, promote_min_days: f.promote_min_days, promote_rate: f.promote_rate, promote_rate_last: f.promote_rate_last,
      demote_rate: f.demote_rate, rate_min_sample: f.rate_min_sample, weekly_invite_cap: f.weekly_invite_cap,
      last_tier_bonus_pct: f.last_tier_bonus_pct, volume_jitter_pct: f.volume_jitter_pct,
      day_start_min: f.day_start_min, day_end_min: f.day_end_min, lunch_start_min: f.lunch_start_min, lunch_end_min: f.lunch_end_min,
      invite_gap_min: f.invite_gap_min, invite_gap_max: f.invite_gap_max, sessions_min: f.sessions_min, sessions_max: f.sessions_max,
      cooldown_days: f.cooldown_days, cooldown_tier_drop: f.cooldown_tier_drop, error_streak_max: f.error_streak_max,
      pending_cap: f.pending_cap, pending_suspend: f.pending_suspend, invite_expiry_days: f.invite_expiry_days,
      reinvite_block_days: f.reinvite_block_days, note_split_pct: f.note_split_pct, note_templates,
      previsit_enabled: f.previsit_enabled, weekdays_only: f.weekdays_only,
    });
  };

  return (
    <div className="card p-5 space-y-5">
      <div className="flex items-center gap-2">
        <TrendingUp className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Montée en charge</p>
      </div>

      <div>
        <span className="label">Paliers (invitations par jour)</span>
        <div className="space-y-1.5">
          {tiers.map((t, i) => (
            <div key={i} className="flex items-center gap-2 text-sm">
              <span className="w-16 text-gray-600">Palier {i + 1}</span>
              <input type="number" className="input py-1 w-20" value={t.min} onChange={(e) => setTier(i, 'min', Number(e.target.value))} />
              <span className="text-gray-400">à</span>
              <input type="number" className="input py-1 w-20" value={t.max} onChange={(e) => setTier(i, 'max', Number(e.target.value))} />
              {tiers.length > 1 && i === tiers.length - 1 && (
                <button className="text-gray-400 hover:text-red-600" onClick={() => setF({ ...f, tiers: tiers.slice(0, -1) })}><Trash2 className="w-3.5 h-3.5" /></button>
              )}
            </div>
          ))}
          {tiers.length < 8 && (
            <button className="text-xs text-[#0a66c2] inline-flex items-center gap-1" onClick={() => setF({ ...f, tiers: [...tiers, { ...tiers[tiers.length - 1] }] })}>
              <Plus className="w-3 h-3" /> Ajouter un palier
            </button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {num('promote_min_days', 'Jours minimum au palier', 'sans incident')}
        {num('promote_rate', 'Taux pour monter', '%')}
        {num('promote_rate_last', 'Taux pour le dernier palier', '%')}
        {num('demote_rate', 'Taux sous lequel on redescend', '%')}
        {num('rate_min_sample', 'Invitations mûres minimum', 'pour juger')}
        {num('volume_jitter_pct', 'Variation du volume du jour', '± %')}
        {num('weekly_invite_cap', 'Plafond sur 7 jours glissants', 'invitations')}
        {num('last_tier_bonus_pct', 'Bonus au dernier palier', '%')}
        {num('pending_suspend', 'Suspendre au-delà de', 'en attente')}
        {num('pending_cap', 'Plafond LinkedIn', 'en attente')}
        {num('invite_expiry_days', 'Retrait des invitations', 'jours')}
        {num('reinvite_block_days', 'Pas de réinvitation pendant', 'jours')}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {time('day_start_min', 'Début')}
        {time('lunch_start_min', 'Pause déjeuner')}
        {time('lunch_end_min', 'Reprise')}
        {time('day_end_min', 'Fin')}
        {num('invite_gap_min', 'Délai mini entre invitations', 'min')}
        {num('invite_gap_max', 'Délai maxi', 'min')}
        {num('sessions_min', 'Sessions par jour, mini')}
        {num('sessions_max', 'Sessions par jour, maxi')}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {num('cooldown_days', 'Durée du cooldown', 'jours')}
        {num('cooldown_tier_drop', 'Paliers perdus au cooldown')}
        {num('error_streak_max', 'Cooldown après', 'erreurs d\'affilée')}
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-700">
        <label className="flex items-center gap-2"><input type="checkbox" className="rounded" checked={f.weekdays_only} onChange={(e) => setF({ ...f, weekdays_only: e.target.checked })} /> Lundi au vendredi uniquement</label>
        <label className="flex items-center gap-2"><input type="checkbox" className="rounded" checked={f.previsit_enabled} onChange={(e) => setF({ ...f, previsit_enabled: e.target.checked })} /> Visiter les profils 1 à 2 jours avant l&apos;invitation</label>
      </div>

      <div className="rounded-lg border border-gray-100 p-3 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="text-sm font-medium text-gray-800">Test de l&apos;invitation : avec ou sans note</p>
          <label className="ml-auto flex items-center gap-2 text-xs text-gray-600">
            Part avec note <input type="number" className="input py-1 w-16" value={f.note_split_pct} onChange={(e) => setF({ ...f, note_split_pct: Number(e.target.value) })} /> %
          </label>
        </div>
        <p className="text-xs text-gray-500">
          Une note par secteur (200 caractères max, variables {'{prenom}'} et {'{entreprise}'}). Sans texte pour le secteur, la note « par défaut » est utilisée ;
          sans aucun texte, toutes les invitations partent sans note. LinkedIn limite les notes sur les comptes gratuits : si elles sont refusées, le test se coupe seul.
        </p>
        {[['default', 'Par défaut'], ...Object.entries(SECTORS)].map(([k, label]) => (
          <label key={k} className="block">
            <span className="label">{label}</span>
            <textarea className="input min-h-[52px] text-sm" maxLength={200} value={notes[k] ?? ''} onChange={(e) => setNote(k, e.target.value)} />
            <span className="text-[11px] text-gray-400">{(notes[k] ?? '').length} / 200</span>
          </label>
        ))}
      </div>

      <button className="btn-primary btn-sm" disabled={save.isPending} onClick={submit}>Enregistrer</button>
    </div>
  );
}
