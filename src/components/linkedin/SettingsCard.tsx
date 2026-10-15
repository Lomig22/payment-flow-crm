'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { linkedinApi, type LinkedinSettings } from '@/lib/api';
import { apiError } from './shared';

// Réglages de la séquence : rythme, plafonds, délais, validation manuelle

type NumField = 'dms_per_day' | 'min_gap_minutes' | 'max_gap_minutes'
  | 'first_msg_min_hours' | 'first_msg_max_hours' | 'r1_days' | 'r2_days' | 'r3_days' | 'end_days'
  | 'inbox_every_minutes' | 'validation_target';

export default function SettingsCard({ settings }: { settings: LinkedinSettings }) {
  const qc = useQueryClient();
  const [form, setForm] = useState(settings);
  useEffect(() => { setForm(settings); }, [settings]);
  const save = useMutation({
    mutationFn: (data: Partial<LinkedinSettings>) => linkedinApi.saveSettings(data),
    onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['linkedin'] }); },
    onError: (e) => toast.error(apiError(e)),
  });

  const num = (field: NumField, label: string, suffix?: string) => (
    <label className="block">
      <span className="label">{label}</span>
      <div className="flex items-center gap-2">
        <input type="number" className="input py-1.5" value={form[field]}
          onChange={(e) => setForm({ ...form, [field]: Number(e.target.value) })} />
        {suffix && <span className="text-xs text-gray-500 whitespace-nowrap">{suffix}</span>}
      </div>
    </label>
  );

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Settings2 className="w-4 h-4 text-gray-500" />
        <p className="text-sm font-semibold text-gray-900">Messages et délais</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {num('dms_per_day', 'Messages par jour', 'premiers + relances')}
        {num('inbox_every_minutes', 'Lecture de la messagerie', 'min')}
        {num('min_gap_minutes', 'Intervalle mini (hors invitations)', 'min')}
        {num('max_gap_minutes', 'Intervalle maxi', 'min')}
        <span />
        {num('first_msg_min_hours', 'Premier message, au plus tôt', 'h après acceptation')}
        {num('first_msg_max_hours', 'Premier message, au plus tard', 'h après acceptation')}
        <span />
        {num('end_days', 'Fin de séquence', 'jours ouvrés après la dernière relance')}
        <p className="text-xs text-gray-500 col-span-full">Nombre de relances, délais et textes : onglet LinkedIn &gt; Messages.</p>
      </div>


      <div className="rounded-lg border border-gray-100 p-3 space-y-2">
        <label className="flex items-center gap-2 text-sm text-gray-700">
          <input type="checkbox" className="rounded" checked={form.manual_validation} onChange={(e) => setForm({ ...form, manual_validation: e.target.checked })} />
          Validation manuelle des messages de l&apos;agent (premiers messages et relances post)
        </label>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          Se désactive après
          <input type="number" className="input py-1 w-20" value={form.validation_target}
            onChange={(e) => setForm({ ...form, validation_target: Number(e.target.value) })} />
          validations ({form.validated_count} faites).
        </div>
      </div>

      <button className="btn-primary btn-sm" disabled={save.isPending}
        onClick={() => save.mutate({
          dms_per_day: form.dms_per_day, inbox_every_minutes: form.inbox_every_minutes,
          min_gap_minutes: form.min_gap_minutes, max_gap_minutes: form.max_gap_minutes,
          first_msg_min_hours: form.first_msg_min_hours, first_msg_max_hours: form.first_msg_max_hours,
          r1_days: form.r1_days, r2_days: form.r2_days, r3_days: form.r3_days, end_days: form.end_days,
          manual_validation: form.manual_validation, validation_target: form.validation_target,
        })}>
        Enregistrer
      </button>
    </div>
  );
}
