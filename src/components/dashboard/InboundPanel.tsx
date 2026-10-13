'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MessageCircle, Inbox, Settings2, ExternalLink, Check, AlertTriangle } from 'lucide-react';
import toast from 'react-hot-toast';
import { inboundApi } from '@/lib/api';
import Spinner from '@/components/ui/Spinner';

const fmt = (iso: string | null) => (iso
  ? new Date(iso).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
  : '');

// Section « Inbound » de la page Contenu : commentaires et DM captés → leads
export default function InboundPanel() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['instagram-inbound'],
    queryFn:  () => inboundApi.overview().then((r) => r.data),
  });

  const [keywords, setKeywords] = useState('');
  const [reply, setReply]       = useState('');
  useEffect(() => {
    if (!data) return;
    setKeywords(data.settings.keywords.join(', '));
    setReply(data.settings.auto_reply_text ?? '');
  }, [data]);

  const save = useMutation({
    mutationFn: () => inboundApi.saveSettings(
      keywords.split(',').map((k) => k.trim()).filter(Boolean),
      reply.trim() || null,
    ),
    onSuccess: () => { toast.success('Réglages enregistrés'); qc.invalidateQueries({ queryKey: ['instagram-inbound'] }); },
    onError:   (e: any) => toast.error(e.response?.data?.message ?? 'Erreur'),
  });

  if (isLoading || !data) return <div className="card p-6 flex justify-center"><Spinner className="w-6 h-6" /></div>;

  return (
    <div className="space-y-3">
      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Inbound — commentaires et DM captés</p>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Réglages */}
        <div className="card p-4 space-y-3">
          <p className="text-sm font-semibold text-gray-900 flex items-center gap-2"><Settings2 className="w-4 h-4 text-gray-500" /> Réglages</p>
          <div>
            <label className="label">Mots-clés de CTA (séparés par des virgules)</label>
            <input value={keywords} onChange={(e) => setKeywords(e.target.value)} className="input" placeholder="BTP, AUDIT" />
            <p className="text-[11px] text-gray-400 mt-1">Un commentaire qui contient un de ces mots crée un lead inbound.</p>
          </div>
          <div>
            <label className="label">Réponse privée automatique</label>
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} maxLength={1000}
              className="input min-h-[90px] resize-y" placeholder="Vide = pas de réponse automatique" />
            <p className="text-[11px] text-gray-400 mt-1">Envoyée en DM à la personne qui commente un mot-clé.</p>
          </div>
          <button onClick={() => save.mutate()} disabled={save.isPending} className="btn-primary btn-sm">
            <Check className="w-3.5 h-3.5" /> Enregistrer
          </button>
        </div>

        {/* Commentaires */}
        <div className="card lg:col-span-2 overflow-hidden">
          <p className="px-4 py-3 text-sm font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100">
            <MessageCircle className="w-4 h-4 text-gray-500" /> Commentaires récents
          </p>
          {data.comments.length === 0 ? (
            <p className="p-6 text-center text-sm text-gray-400">Aucun commentaire capté pour l&apos;instant.</p>
          ) : (
            <div className="divide-y divide-gray-50 max-h-80 overflow-y-auto">
              {data.comments.map((c) => (
                <div key={c.id} className="px-4 py-2.5 text-sm flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-gray-900">
                      <span className="font-medium">@{c.username}</span>{' '}
                      <span className="text-gray-700">{c.text}</span>
                    </p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {fmt(c.commented_at)} · {c.ig_content?.caption?.split('\n')[0] ?? 'contenu'}
                    </p>
                    {c.reply_error && (
                      <p className="text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Réponse auto : {c.reply_error}</p>
                    )}
                  </div>
                  {c.keyword && <span className="badge bg-violet-100 text-violet-700">{c.keyword}</span>}
                  {c.replied_at && <span className="badge bg-green-100 text-green-700">DM envoyé</span>}
                  {c.lead_id && <Link href={`/leads/${c.lead_id}`} className="badge bg-blue-100 text-blue-700">Lead →</Link>}
                  {c.ig_content?.permalink && (
                    <a href={c.ig_content.permalink} target="_blank" rel="noopener noreferrer" className="text-gray-400 hover:text-gray-700">
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Conversations entrantes */}
      <div className="card overflow-hidden">
        <p className="px-4 py-3 text-sm font-semibold text-gray-900 flex items-center gap-2 border-b border-gray-100">
          <Inbox className="w-4 h-4 text-gray-500" /> Nouvelles conversations entrantes
        </p>
        {data.conversations.length === 0 ? (
          <p className="p-6 text-center text-sm text-gray-400">Aucune nouvelle conversation entrante pour l&apos;instant.</p>
        ) : (
          <div className="divide-y divide-gray-50">
            {data.conversations.map((c) => (
              <div key={c.id} className="px-4 py-2.5 text-sm flex items-center gap-3">
                <span className="font-medium text-gray-900">@{c.participant_username}</span>
                <span className="badge bg-gray-100 text-gray-600">{c.channel === 'story_reply' ? 'Réponse à une story' : 'DM entrant'}</span>
                <span className="text-[11px] text-gray-400">{fmt(c.first_message_at)}</span>
                {c.lead_id && <Link href={`/leads/${c.lead_id}`} className="badge bg-blue-100 text-blue-700 ml-auto">Lead →</Link>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
