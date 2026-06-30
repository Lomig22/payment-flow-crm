'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Edit2, Phone, Mail, MapPin, Building, User,
  CheckCircle, XCircle, History, Globe,
} from 'lucide-react';
import { qualiopiLeadsApi } from '@/lib/api';
import Badge from '@/components/ui/Badge';
import Modal from '@/components/ui/Modal';
import Spinner from '@/components/ui/Spinner';
import QualiopiLeadForm from '@/components/leads/QualiopiLeadForm';
import { formatDateTime, timeAgo, QUALITY_LABELS, FIELD_LABELS } from '@/lib/utils';
import type { QualiopiLead } from '@/types';

const BoolField = ({ label, value }: { label: string; value: boolean }) => (
  <div className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
    <span className="text-sm text-gray-600">{label}</span>
    {value
      ? <CheckCircle className="w-5 h-5 text-green-500" />
      : <XCircle className="w-5 h-5 text-gray-300" />}
  </div>
);

export default function QualiopiLeadDetailPage() {
  const { id }   = useParams<{ id: string }>();
  const router   = useRouter();
  const qc       = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: lead, isLoading } = useQuery({
    queryKey: ['qualiopi-lead', id],
    queryFn:  () => qualiopiLeadsApi.getOne(id).then((r) => r.data as QualiopiLead),
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
              <div className="w-14 h-14 rounded-full bg-teal-100 text-teal-700 flex items-center justify-center text-xl font-bold flex-shrink-0">
                {lead.company?.slice(0, 2).toUpperCase()}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900 flex items-center gap-2">
                  <Building className="w-4 h-4 text-gray-400" />
                  {lead.company}
                </h2>
                {lead.dirigeant && (
                  <p className="text-gray-500 flex items-center gap-1 text-sm mt-0.5">
                    <User className="w-3.5 h-3.5" />
                    {lead.dirigeant}
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
              {lead.city && (
                <p className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  {lead.city}
                </p>
              )}
              <p className="flex items-center gap-2 text-sm text-gray-600">
                <Globe className="w-4 h-4 text-gray-400" />
                {lead.has_website ? 'A déjà un site web' : 'Sans site web'}
              </p>
            </div>
          </div>

          {/* Commercial tracking */}
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-gray-900 mb-4">Suivi commercial</h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <p className="text-xs text-gray-400 mb-1">Activité</p>
                <p className="text-sm font-medium">{lead.activite ?? '—'}</p>
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
            <BoolField label="Appelé"       value={lead.called} />
            <BoolField label="RDV pris"     value={lead.appointment_taken} />
            <BoolField label="RDV honoré"   value={lead.appointment_honored} />
            <BoolField label="Devis envoyé" value={lead.quote_sent} />
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
        <QualiopiLeadForm
          lead={lead}
          onSuccess={() => {
            setEditOpen(false);
            qc.invalidateQueries({ queryKey: ['qualiopi-lead', id] });
            qc.invalidateQueries({ queryKey: ['qualiopi-leads'] });
            qc.invalidateQueries({ queryKey: ['leads-pipeline'] });
            qc.invalidateQueries({ queryKey: ['qualiopi-counts'] });
            qc.invalidateQueries({ queryKey: ['qualiopi-dashboard-stats'] });
          }}
          onCancel={() => setEditOpen(false)}
        />
      </Modal>
    </div>
  );
}
