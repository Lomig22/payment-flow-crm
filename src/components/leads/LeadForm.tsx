'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { Lead } from '@/types';

const schema = z.object({
  first_name:         z.string().min(1, 'Prénom requis'),
  last_name:          z.string().min(1, 'Nom requis'),
  company:            z.string().optional(),
  phone:              z.string().optional(),
  email:              z.string().email('Email invalide').optional().or(z.literal('')),
  location:           z.string().optional(),
  called:             z.boolean().default(false),
  action_in_progress: z.enum(['to_call', 'callback', 'follow_up', 'negotiation', 'no_action']).default('to_call'),
  lead_quality:       z.enum(['hot', 'warm', 'cold']).optional().or(z.literal('')),
  need_identified:    z.string().optional(),
  setter_id:          z.string().optional(),
  appointment_taken:  z.boolean().default(false),
  appointment_honored:z.boolean().default(false),
  quote_sent:         z.boolean().default(false),
  r2_planned:         z.boolean().default(false),
  r3_planned:         z.boolean().default(false),
  status:             z.enum(['lost', 'in_progress', 'client', 'to_follow_up', 'to_follow_up_2', 'appointment', 'r2']).default('in_progress'),
  notes:              z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface LeadFormProps {
  lead?:      Lead;
  onSuccess:  (lead: Lead) => void;
  onCancel:   () => void;
}

export default function LeadForm({ lead, onSuccess, onCancel }: LeadFormProps) {
  const user    = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin';

  const { data: setters } = useQuery({
    queryKey: ['users-setters'],
    queryFn:  () => usersApi.getAll({ role: 'setter', is_active: 'true' }).then((r) => r.data),
    enabled:  isAdmin,
  });

  const { register, handleSubmit, formState: { errors } } = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: lead
      ? {
          first_name:          lead.first_name,
          last_name:           lead.last_name,
          company:             lead.company ?? '',
          phone:               lead.phone ?? '',
          email:               lead.email ?? '',
          location:            lead.location ?? '',
          called:              lead.called,
          action_in_progress:  lead.action_in_progress,
          lead_quality:        lead.lead_quality ?? '' as any,
          need_identified:     lead.need_identified ?? '',
          setter_id:           lead.setter_id ?? '',
          appointment_taken:   lead.appointment_taken,
          appointment_honored: lead.appointment_honored,
          quote_sent:          lead.quote_sent,
          r2_planned:          lead.r2_planned,
          r3_planned:          lead.r3_planned,
          status:              lead.status,
          notes:               lead.notes ?? '',
        }
      : undefined,
  });

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const payload = { ...data, lead_quality: data.lead_quality || undefined };
      return lead
        ? leadsApi.update(lead.id, payload).then((r) => r.data)
        : leadsApi.create(payload).then((r) => r.data);
    },
    onSuccess: (data) => {
      toast.success(lead ? 'Lead mis à jour' : 'Lead créé');
      onSuccess(data);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message ?? 'Erreur');
    },
  });

  const F = ({ label, name, error, children }: { label: string; name: string; error?: string; children: React.ReactNode }) => (
    <div>
      <label className="label" htmlFor={name}>{label}</label>
      {children}
      {error && <p className="field-error">{error}</p>}
    </div>
  );

  return (
    <form onSubmit={handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
      {/* Identité */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Identité</p>
      <div className="grid grid-cols-2 gap-3">
        <F label="Prénom *" name="first_name" error={errors.first_name?.message}>
          <input {...register('first_name')} className="input" placeholder="Jean" />
        </F>
        <F label="Nom *" name="last_name" error={errors.last_name?.message}>
          <input {...register('last_name')} className="input" placeholder="Dupont" />
        </F>
        <F label="Société" name="company">
          <input {...register('company')} className="input" placeholder="Acme SA" />
        </F>
        <F label="Téléphone" name="phone">
          <input {...register('phone')} className="input" placeholder="06 12 34 56 78" />
        </F>
        <F label="Email" name="email" error={errors.email?.message}>
          <input {...register('email')} className="input" placeholder="jean@acme.fr" />
        </F>
        <F label="Localisation" name="location">
          <input {...register('location')} className="input" placeholder="Paris 75001" />
        </F>
      </div>

      {/* Suivi commercial */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">Suivi commercial</p>
      <div className="grid grid-cols-2 gap-3">
        <F label="Action en cours" name="action_in_progress">
          <select {...register('action_in_progress')} className="select">
            <option value="to_call">À appeler</option>
            <option value="callback">Rappel</option>
            <option value="follow_up">Suivi</option>
            <option value="negotiation">Négociation</option>
            <option value="no_action">Aucune action</option>
          </select>
        </F>
        <F label="Qualité du lead" name="lead_quality">
          <select {...register('lead_quality')} className="select">
            <option value="">Non qualifié</option>
            <option value="hot">🔥 Chaud</option>
            <option value="warm">🌡️ Tiède</option>
            <option value="cold">❄️ Froid</option>
          </select>
        </F>
        {isAdmin && setters && (
          <F label="Setter assigné" name="setter_id">
            <select {...register('setter_id')} className="select">
              <option value="">Non assigné</option>
              {setters.map((s: any) => (
                <option key={s.id} value={s.id}>{s.first_name} {s.last_name}</option>
              ))}
            </select>
          </F>
        )}
        <F label="Statut" name="status">
          <select {...register('status')} className="select">
            <option value="in_progress">En cours</option>
            <option value="to_follow_up">À relancer</option>
            <option value="to_follow_up_2">À relancer 2</option>
            <option value="appointment">RDV pris</option>
            <option value="r2">R2 pris</option>
            <option value="client">Client</option>
            <option value="lost">Perdu</option>
          </select>
        </F>
      </div>

      <F label="Besoin identifié" name="need_identified">
        <textarea {...register('need_identified')} className="input min-h-[80px] resize-y"
          placeholder="Décrivez le besoin du prospect…" />
      </F>

      {/* Checkboxes */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">Après appel</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {([
          ['called',              'Appelé'],
          ['appointment_taken',   'RDV pris'],
          ['appointment_honored', 'RDV honoré'],
          ['quote_sent',          'Devis envoyé'],
          ['r2_planned',          'R2 planifié'],
          ['r3_planned',          'R3 planifié'],
        ] as const).map(([field, label]) => (
          <label key={field} className="flex items-center gap-2 text-sm cursor-pointer select-none">
            <input type="checkbox" {...register(field)} className="rounded text-primary-600 w-4 h-4" />
            {label}
          </label>
        ))}
      </div>

      <F label="Notes" name="notes">
        <textarea {...register('notes')} className="input min-h-[80px] resize-y"
          placeholder="Notes internes…" />
      </F>

      {/* Actions */}
      <div className="flex justify-end gap-3 pt-2">
        <button type="button" onClick={onCancel} className="btn-secondary">Annuler</button>
        <button type="submit" disabled={mutation.isPending} className="btn-primary">
          {mutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
          {lead ? 'Enregistrer' : 'Créer le lead'}
        </button>
      </div>
    </form>
  );
}
