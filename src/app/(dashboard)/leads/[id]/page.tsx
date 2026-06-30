'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Edit2, Phone, Mail, MapPin, Building,
  CheckCircle, XCircle, Clock, History,
} from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import LeadForm from '@/components/leads/LeadForm';
import {
  formatDateTime, timeAgo, ACTION_LABELS, STATUS_LABELS,
  QUALITY_LABELS, FIELD_LABELS,
} from '@/lib/utils';
import type { Lead } from '@/types';

const BoolField = ({ label, value }: { label: string; value: boolean }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
    <span className="text-sm text-gray-600">{label}</span>
    {value
      ? <CheckCircle className="w-5 h-5 text-green-500" />
      : <XCircle className="w-5 h-5 text-gray-300" />}
  </div>
);

export default function LeadDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const qc       = useQueryClient();
  const user     = useAuthStore((s) => s.user);
  const isAdmin  = user?.role === 'admin';
  const [editOpen, setEditOpen] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['lead', id],
    queryFn:  () => leadsApi.getOne(id).then((r) => r.data as Lead),
  });

  if (isLoading) {
    return <div className="flex items-center justify-center h-64"><Spinner className="w-8 h-8" /></div>;
  }

  if (!lead) {
    return (
      <div className="card p-8 text-center">
        <p className="text-gray-500">Lead introuvable</p>
        <button onClick={() => router.back()} className="btn-secondary mt-4">Retour</button>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Back + actions */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="btn-ghost btn-sm">
          <ArrowLeft className="w-4 h-4" />
          Retour
        </button>
        <div className="ml-auto flex items-center gap-2">
          <Badge variant={lead.status} />
          {lead.lead_quality && <Badge variant={lead.lead_quality} />}
          <button onClick={() => setEditOpen(true)} className="btn-primary btn-sm">
            <Edit2 className="w-3.5 h-3.5" />
            Modifier
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left column */}
        <div className="lg:col-span-2 space-y-5">
          {/* Identity card */}
          <div className="card p-5">
            <div className="flex items-start gap-4 mb-5">
              <div className="w-14 h-14 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
                {lead.first_name?.[0]}{lead.last_name?.[0]}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  {lead.first_name} {lead.last_name}
                </h2>
                {lead.company && (
                  <p className="text-gray-500 flex items-center gap-1 text-sm mt-0.5">
                    <Building className="w-3.5 h-3.5" />
                    {lead.company}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              {lead.phone && (
                <a href={`tel:${lead.phone}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600 transition-colors">
                  <Phone className="w-4 h-4 text-gray-400" />
                  {lead.phone}
                </a>
              )}
              {lead.email && (
                <a href={`mailto:${lead.email}`} className="flex items-center gap-2 text-sm text-gray-600 hover:text-primary-600 transition-colors">
                  <Mail className="w-4 h-4 text-gray-400" />
                  {lead.email}
                </a>
              )}
              {lead.location && (
                <p className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  {lead.location}
                </p>
              )}
            </div>
          </div>

          {/* Commercial tracking */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Suivi commercial</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Action en cours</p>
                <p className="text-sm font-medium">{ACTION_LABELS[lead.action_in_progress]}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Qualité</p>
                <p className="text-sm font-medium">
                  {lead.lead_quality ? QUALITY_LABELS[lead.lead_quality] : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Setter</p>
                <p className="text-sm font-medium">
                  {lead.setter
                    ? `${lead.setter.first_name} ${lead.setter.last_name}`
                    : <span className="text-gray-400">Non assigné</span>}
                </p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-1">Statut final</p>
                <Badge variant={lead.status} />
              </div>
            </div>

            {lead.need_identified && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Besoin identifié</p>
                <p className="text-sm text-gray-700">{lead.need_identified}</p>
              </div>
            )}

            {lead.notes && (
              <div className="mt-4 pt-4 border-t border-gray-100">
                <p className="text-xs text-gray-400 mb-1">Notes</p>
                <p className="text-sm text-gray-700 whitespace-pre-line">{lead.notes}</p>
              </div>
            )}
          </div>

          {/* Tags */}
          {lead.tags && lead.tags.length > 0 && (
            <div className="card p-5">
              <h3 className="text-sm font-semibold text-gray-900 mb-3">Tags</h3>
              <div className="flex flex-wrap gap-2">
                {lead.tags.map((tag) => (
                  <span
                    key={tag.id}
                    className="badge text-white"
                    style={{ backgroundColor: tag.color }}
                  >
                    {tag.name}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* History */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
              <History className="w-4 h-4 text-gray-400" />
              Historique
            </h3>
            {lead.history && lead.history.length > 0 ? (
              <div className="space-y-3">
                {lead.history.map((h) => (
                  <div key={h.id} className="flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-primary-400 mt-2 flex-shrink-0" />
                    <div className="flex-1">
                      <p className="text-sm text-gray-700">
                        {h.action_note
                          ? h.action_note
                          : h.field_changed
                            ? `${FIELD_LABELS[h.field_changed] ?? h.field_changed} : "${h.old_value}" → "${h.new_value}"`
                            : 'Modification'}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {h.first_name && `${h.first_name} ${h.last_name} · `}
                        {timeAgo(h.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">Aucun historique</p>
            )}
          </div>
        </div>

        {/* Right column: checklist */}
        <div className="space-y-5">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Checklist</h3>
            <BoolField label="Appelé"        value={lead.called} />
            <BoolField label="RDV pris"      value={lead.appointment_taken} />
            <BoolField label="RDV honoré"    value={lead.appointment_honored} />
            <BoolField label="Devis envoyé"  value={lead.quote_sent} />
            <BoolField label="R2 planifié"   value={lead.r2_planned} />
            <BoolField label="R3 planifié"   value={lead.r3_planned} />
          </div>

          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-3">Informations</h3>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-400">Créé le</p>
                <p className="text-sm">{formatDateTime(lead.created_at)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Dernière mise à jour</p>
                <p className="text-sm">{timeAgo(lead.updated_at)}</p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Edit modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Modifier le lead" size="xl">
        <LeadForm
          lead={lead}
          onSuccess={() => {
            setEditOpen(false);
            qc.invalidateQueries({ queryKey: ['lead', id] });
            qc.invalidateQueries({ queryKey: ['leads'] });
            // Le statut/RDV peut changer → rafraîchir pipeline, listes par pôle,
            // compteurs et dashboards qui s'organisent par statut.
            qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
            qc.invalidateQueries({ queryKey: ['leads-cold-call'] });
            qc.invalidateQueries({ queryKey: ['leads-cc-counts'] });
            qc.invalidateQueries({ queryKey: ['dashboard-stats'] });
            qc.invalidateQueries({ queryKey: ['leaderboard'] });
          }}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>
    </div>
  );
}
