'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { AlertTriangle } from 'lucide-react';
import { leadsApi } from '@/lib/api';

// Bannière doublons — seul endroit où les doublons sont affichés :
// en haut de chaque page leads, scopée au canal de la page
// (source omise = toutes sources confondues, page « Tous les leads »).
export default function DuplicatesBanner({ source, label }: { source?: string; label?: string }) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(true);

  const { data } = useQuery({
    queryKey: ['leads-duplicates', source ?? 'all'],
    queryFn:  () => leadsApi.duplicates(source).then((r) => r.data),
    staleTime: 5 * 60 * 1000,
  });

  if (!data || data.count === 0) return null;

  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 overflow-hidden shadow-sm">
      <div className="flex items-center gap-3 px-4 py-3 bg-amber-100 border-b border-amber-300">
        <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0" />
        <span className="flex-1 text-sm font-semibold text-amber-900">
          ⚠️ {data.count} lead{data.count > 1 ? 's' : ''} en doublon détecté{data.count > 1 ? 's' : ''} dans {label ?? 'votre base'}
        </span>
        <button
          onClick={() => setExpanded((v) => !v)}
          className="text-xs text-amber-700 underline hover:text-amber-900"
        >
          {expanded ? 'Réduire' : 'Voir le détail'}
        </button>
      </div>
      {expanded && (
        <div className="px-4 py-3">
          <ul className="space-y-1.5">
            {data.groups.map((g, i) => (
              <li key={i} className="text-xs text-amber-800 flex items-start gap-2">
                <span className="shrink-0 font-semibold bg-amber-200 text-amber-900 rounded px-1.5 py-0.5">
                  {g.field === 'phone' ? 'Tél' : g.field === 'instagram_username' ? '@IG' : 'Email'}
                </span>
                <span>
                  <span className="font-medium">
                    {g.field === 'instagram_username' ? `@${g.value}` : g.value}
                  </span>
                  {' — '}
                  {g.leads.map((l, j) => (
                    <button
                      key={l.id}
                      onClick={() => router.push(`/leads/${l.id}`)}
                      className="underline hover:text-amber-900"
                    >
                      {l.first_name} {l.last_name}{j < g.leads.length - 1 ? ' · ' : ''}
                    </button>
                  ))}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-amber-600 mt-2">
            Cliquez sur un nom pour ouvrir le lead et supprimer le doublon.
          </p>
        </div>
      )}
    </div>
  );
}
