'use client';
import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/store/authStore';
import { shiftsApi } from '@/lib/api';
import { Clock, UserCheck, UserX, Calendar, Timer } from 'lucide-react';
import Spinner from '@/components/ui/Spinner';
import { useRouter } from 'next/navigation';

function formatDuration(startedAt: string, endedAt?: string | null): string {
  const start = new Date(startedAt).getTime();
  const end   = endedAt ? new Date(endedAt).getTime() : Date.now();
  const total = Math.floor((end - start) / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m.toString().padStart(2, '0')}min`;
  if (m > 0) return `${m}min ${s.toString().padStart(2, '0')}s`;
  return `${s}s`;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

function getInitials(first: string, last: string) {
  return `${first?.[0] ?? ''}${last?.[0] ?? ''}`.toUpperCase();
}

/* Live duration counter that ticks every second */
function LiveDuration({ startedAt }: { startedAt: string }) {
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <>{formatDuration(startedAt)}</>;
}

export default function RessourcesPage() {
  const user   = useAuthStore((s) => s.user);
  const router = useRouter();

  // Redirect non-admins
  useEffect(() => {
    if (user && user.role !== 'admin') router.replace('/dashboard');
  }, [user, router]);

  const [selectedDate, setSelectedDate] = useState(
    new Date().toISOString().slice(0, 10)
  );

  const { data: shifts = [], isLoading } = useQuery({
    queryKey:        ['shifts', selectedDate],
    queryFn:         () => shiftsApi.list(selectedDate).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const active    = shifts.filter((s: any) => !s.ended_at);
  const completed = shifts.filter((s: any) => !!s.ended_at);

  if (!user || user.role !== 'admin') return null;

  return (
    <div className="space-y-6 max-w-4xl">

      {/* Date picker */}
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input
            type="date"
            value={selectedDate}
            onChange={(e) => setSelectedDate(e.target.value)}
            className="input py-1.5 text-sm w-auto"
          />
        </div>
        {selectedDate === new Date().toISOString().slice(0, 10) && (
          <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium flex items-center gap-1">
            <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse inline-block" />
            Temps réel · actualisation toutes les 30s
          </span>
        )}
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center h-32">
          <Spinner className="w-8 h-8" />
        </div>
      ) : (
        <>
          {/* ── Active shifts ─────────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <UserCheck className="w-4 h-4 text-green-500" />
              Actuellement connectés
              <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                {active.length}
              </span>
            </h2>

            {active.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                Personne n'est connecté en ce moment.
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {active.map((shift: any) => {
                  const u = shift.users;
                  return (
                    <div key={shift.id} className="card p-4 border-l-4 border-l-green-400">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-green-100 text-green-700 flex items-center justify-center font-bold text-sm flex-shrink-0">
                          {getInitials(u?.first_name ?? '?', u?.last_name ?? '')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="font-semibold text-gray-900 text-sm truncate">
                            {u?.first_name} {u?.last_name}
                          </p>
                          <p className="text-xs text-gray-400 capitalize">{u?.role}</p>
                        </div>
                        <span className="w-2.5 h-2.5 bg-green-400 rounded-full flex-shrink-0 animate-pulse" />
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-xs text-gray-500">
                        <div>
                          <p className="text-gray-400">Arrivée</p>
                          <p className="font-semibold text-gray-700">{formatTime(shift.started_at)}</p>
                        </div>
                        <div>
                          <p className="text-gray-400">Durée</p>
                          <p className="font-semibold text-indigo-600">
                            <LiveDuration startedAt={shift.started_at} />
                          </p>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {/* ── Completed shifts ──────────────────────────────────────── */}
          <section>
            <h2 className="text-sm font-semibold text-gray-700 mb-3 flex items-center gap-2">
              <Timer className="w-4 h-4 text-gray-400" />
              Shifts terminés
              <span className="bg-gray-100 text-gray-600 text-xs px-2 py-0.5 rounded-full font-medium">
                {completed.length}
              </span>
            </h2>

            {completed.length === 0 ? (
              <div className="card p-6 text-center text-sm text-gray-400">
                Aucun shift terminé pour cette date.
              </div>
            ) : (
              <div className="card overflow-hidden">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-100 text-xs text-gray-500 font-medium">
                      <th className="text-left px-4 py-3">Membre</th>
                      <th className="text-left px-4 py-3">Arrivée</th>
                      <th className="text-left px-4 py-3">Départ</th>
                      <th className="text-left px-4 py-3">Durée totale</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {completed.map((shift: any) => {
                      const u = shift.users;
                      return (
                        <tr key={shift.id} className="hover:bg-gray-50 transition-colors">
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                                {getInitials(u?.first_name ?? '?', u?.last_name ?? '')}
                              </div>
                              <div>
                                <p className="font-medium text-gray-900">
                                  {u?.first_name} {u?.last_name}
                                </p>
                                <p className="text-xs text-gray-400 capitalize">{u?.role}</p>
                              </div>
                            </div>
                          </td>
                          <td className="px-4 py-3 text-gray-700 tabular-nums">
                            {formatTime(shift.started_at)}
                          </td>
                          <td className="px-4 py-3 text-gray-700 tabular-nums">
                            {shift.ended_at ? formatTime(shift.ended_at) : '—'}
                          </td>
                          <td className="px-4 py-3">
                            <span className="font-semibold text-indigo-600">
                              {shift.ended_at
                                ? formatDuration(shift.started_at, shift.ended_at)
                                : '—'
                              }
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          {/* ── Summary stats ─────────────────────────────────────────── */}
          {shifts.length > 0 && (
            <section className="grid grid-cols-3 gap-3">
              {[
                {
                  label: 'Total pointages',
                  value: shifts.length,
                  icon: <Clock className="w-4 h-4 text-indigo-500" />,
                  bg: 'bg-indigo-50',
                },
                {
                  label: 'En ligne maintenant',
                  value: active.length,
                  icon: <UserCheck className="w-4 h-4 text-green-500" />,
                  bg: 'bg-green-50',
                },
                {
                  label: 'Shifts terminés',
                  value: completed.length,
                  icon: <UserX className="w-4 h-4 text-gray-400" />,
                  bg: 'bg-gray-50',
                },
              ].map(({ label, value, icon, bg }) => (
                <div key={label} className={`card p-4 ${bg}`}>
                  <div className="flex items-center gap-2 mb-1">{icon}<p className="text-xs text-gray-500">{label}</p></div>
                  <p className="text-2xl font-bold text-gray-900">{value}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  );
}
