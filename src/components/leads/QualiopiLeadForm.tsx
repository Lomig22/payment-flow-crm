'use client';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { qualiopiLeadsApi, usersApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import type { QualiopiLead } from '@/types';

const schema = z.object({
  company:            z.string().min(1, 'Entreprise requise'),
  dirigeant:          z.string().optional(),
  activite:           z.string().optional(),
  phone:              z.string().optional(),
  email:              z.string().email('Email invalide').optional().or(z.literal('')),
  city:               z.string().optional(),
  has_website:        z.boolean().default(false),
  called:             z.boolean().default(false),
  lead_quality:       z.enum(['hot', 'warm', 'cold']).optional().or(z.literal('')),
  need_identified:    z.string().optional(),
  setter_id:          z.string().optional(),
  appointment_taken:  z.boolean().default(false),
  appointment_honored:z.boolean().default(false),
  quote_sent:         z.boolean().default(false),
  status:             z.enum(['lost', 'in_progress', 'client', 'to_follow_up', 'to_follow_up_2', 'appointment', 'r2']).default('in_progress'),
  notes:              z.string().optional(),
});

type FormData = z.infer<typeof schema>;

interface QualiopiLeadFormProps {
  lead?:     QualiopiLead;
  onSuccess: (lead: QualiopiLead) => void;
  onCancel:  () => void;
}

export default function QualiopiLeadForm({ lead, onSuccess, onCancel }: QualiopiLeadFormProps) {
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
          company:             lead.company,
          dirigeant:           lead.dirigeant ?? '',
          activite:            lead.activite ?? '',
          phone:               lead.phone ?? '',
          email:               lead.email ?? '',
          city:                lead.city ?? '',
          has_website:         lead.has_website,
          called:              lead.called,
          lead_quality:        lead.lead_quality ?? '' as any,
          need_identified:     lead.need_identified ?? '',
          setter_id:           lead.setter_id ?? '',
          appointment_taken:   lead.appointment_taken,
          appointment_honored: lead.appointment_honored,
          quote_sent:          lead.quote_sent,
          status:              lead.status,
          notes:               lead.notes ?? '',
        }
      : undefined,
  });

  const mutation = useMutation({
    mutationFn: (data: FormData) => {
      const payload = { ...data, lead_quality: data.lead_quality || undefined };
      return lead
        ? qualiopiLeadsApi.update(lead.id, payload).then((r) => r.data)
        : qualiopiLeadsApi.create(payload).then((r) => r.data);
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
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Organisme</p>
      <div className="grid grid-cols-2 gap-3">
        <F label="Entreprise *" name="company" error={errors.company?.message}>
          <input {...register('company')} className="input" placeholder="Centre de formation X" />
        </F>
        <F label="Dirigeant" name="dirigeant">
          <input {...register('dirigeant')} className="input" placeholder="Jean Dupont" />
        </F>
        <F label="Activité" name="activite">
          <input {...register('activite')} className="input" placeholder="Santé, Commerce…" />
        </F>
        <F label="Téléphone" name="phone">
          <input {...register('phone')} className="input" placeholder="06 12 34 56 78" />
        </F>
        <F label="Email" name="email" error={errors.email?.message}>
          <input {...register('email')} className="input" placeholder="contact@organisme.fr" />
        </F>
        <F label="Ville" name="city">
          <input {...register('city')} className="input" placeholder="Aix-en-Provence" />
        </F>
      </div>
      <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
        <input type="checkbox" {...register('has_website')} className="rounded text-primary-600 w-4 h-4" />
        A déjà un site web
      </label>

      {/* Suivi commercial */}
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider pt-2">Suivi commercial</p>
      <div className="grid grid-cols-2 gap-3">
        <F label="Qualité du lead" name="lead_quality">
          <select {...register('lead_quality')} className="select">
            <option value="">Non qualifié</option>
            <option value="hot">🔥 Chaud</option>
            <option value="warm">🌡️ Tiède</option>
            <option value="cold">❄️ Froid</option>
          </select>
        </F>
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
