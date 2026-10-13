'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, Check, BellRing, Settings2, X } from 'lucide-react';
import toast from 'react-hot-toast';
import { contentApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

// Alarme de publication (admins) : rappelle de poster un reel toutes les N minutes
// dans la plage horaire choisie, d'après le dernier post relevé par la synchro.
// Réglages et report propres à chaque navigateur (localStorage).

interface AlarmSettings { enabled: boolean; interval: number; start: number; end: number; sound: boolean }
const DEFAULTS: AlarmSettings = { enabled: true, interval: 60, start: 9, end: 21, sound: true };
const KEY        = 'pf_posting_alarm';
const SNOOZE_KEY = 'pf_posting_alarm_snooze';
const REPEAT_MS  = 10 * 60_000;   // rappel sonore toutes les 10 min tant que c'est l'heure

function load<T>(key: string, fallback: T): T {
  try { const v = localStorage.getItem(key); return v ? { ...fallback, ...JSON.parse(v) } : fallback; }
  catch { return fallback; }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible */ }
}

function beep() {
  try {
    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
    [0, 0.25, 0.5].forEach((t) => {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.15, ctx.currentTime + t);
      g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + t + 0.2);
      o.connect(g).connect(ctx.destination);
      o.start(ctx.currentTime + t);
      o.stop(ctx.currentTime + t + 0.2);
    });
  } catch { /* audio bloqué par le navigateur */ }
}

// Prochaine échéance : dernier post + intervalle, ramenée dans la plage horaire du jour
function nextDue(lastPostAt: string | null, s: AlarmSettings, now: Date): Date {
  const windowStart = new Date(now); windowStart.setHours(s.start, 0, 0, 0);
  const windowEnd   = new Date(now); windowEnd.setHours(s.end, 0, 0, 0);
  let due = lastPostAt ? new Date(new Date(lastPostAt).getTime() + s.interval * 60_000) : windowStart;
  if (due < windowStart) due = windowStart;
  if (due >= windowEnd) { due = new Date(windowStart); due.setDate(due.getDate() + 1); }
  return due;
}

const fmtTime = (d: Date) => d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });

export default function PostingAlarm() {
  const isAdmin = useAuthStore((s) => s.user?.role === 'admin');
  const qc      = useQueryClient();
  const [settings, setSettings] = useState<AlarmSettings>(DEFAULTS);
  const [snoozeUntil, setSnoozeUntil] = useState(0);
  const [now, setNow]           = useState(() => new Date());
  const [showSettings, setShowSettings] = useState(false);
  const lastAlert = useRef(0);

  useEffect(() => {
    setSettings(load(KEY, DEFAULTS));
    setSnoozeUntil(load(SNOOZE_KEY, { t: 0 }).t);
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  const { data } = useQuery({
    queryKey: ['posting-status'],
    queryFn:  () => contentApi.postingStatus().then((r) => r.data),
    enabled:  isAdmin && settings.enabled,
    refetchInterval: 2 * 60_000,
  });

  const due     = data ? nextDue(data.last_post_at, settings, now) : null;
  const isDue   = !!due && settings.enabled && now >= due && now.getTime() >= snoozeUntil;
  const minutes = data?.last_post_at ? Math.round((now.getTime() - new Date(data.last_post_at).getTime()) / 60_000) : null;

  // Son + notification à l'échéance, puis toutes les 10 min tant que rien n'est posté
  useEffect(() => {
    if (!isDue || Date.now() - lastAlert.current < REPEAT_MS) return;
    lastAlert.current = Date.now();
    if (settings.sound) beep();
    try {
      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('⏰ C\'est l\'heure de poster un reel', {
          body: `${data?.today.posts ?? 0}/${data?.targets.reel ?? 0} aujourd'hui${minutes != null ? ` · dernier post il y a ${minutes} min` : ''}`,
          tag:  'pf-posting-alarm',
        });
      }
    } catch { /* notifications indisponibles */ }
  }, [isDue, now]); // eslint-disable-line react-hooks/exhaustive-deps

  const snooze = useCallback((min: number) => {
    const t = Date.now() + min * 60_000;
    setSnoozeUntil(t); save(SNOOZE_KEY, { t });
  }, []);

  // « J'ai posté » : synchro immédiate pour relever le nouveau post
  const posted = useMutation({
    mutationFn: async () => {
      const before = data?.last_post_at;
      await contentApi.sync();
      const fresh = (await contentApi.postingStatus()).data;
      return { detected: fresh.last_post_at !== before };
    },
    onSuccess: ({ detected }) => {
      qc.invalidateQueries({ queryKey: ['posting-status'] });
      qc.invalidateQueries({ queryKey: ['instagram-content'] });
      if (detected) toast.success('Post relevé ✅ Prochain rappel dans une heure');
      else { toast('Pas encore visible côté Instagram : nouveau contrôle dans 5 min', { icon: '⏳' }); snooze(5); }
    },
    onError: () => toast.error('Synchro impossible'),
  });

  const update = (patch: Partial<AlarmSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next); save(KEY, next);
  };

  if (!isAdmin || !data) return null;

  return (
    <div className="fixed bottom-4 right-4 z-40 flex flex-col items-end gap-2 max-w-[calc(100vw-2rem)]">
      {showSettings && (
        <div className="card p-4 w-72 space-y-3 shadow-lg">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">Alarme de publication</p>
            <button onClick={() => setShowSettings(false)} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-4 h-4" /></button>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={settings.enabled} onChange={(e) => update({ enabled: e.target.checked })} className="rounded" />
            Activée
          </label>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="label">Toutes les</label>
              <select value={settings.interval} onChange={(e) => update({ interval: +e.target.value })} className="select text-sm">
                {[30, 45, 60, 75, 90, 120].map((m) => <option key={m} value={m}>{m} min</option>)}
              </select>
            </div>
            <div>
              <label className="label">De</label>
              <select value={settings.start} onChange={(e) => update({ start: +e.target.value })} className="select text-sm">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{h} h</option>)}
              </select>
            </div>
            <div>
              <label className="label">À</label>
              <select value={settings.end} onChange={(e) => update({ end: +e.target.value })} className="select text-sm">
                {Array.from({ length: 24 }, (_, h) => <option key={h} value={h + 1}>{h + 1} h</option>)}
              </select>
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={settings.sound} onChange={(e) => update({ sound: e.target.checked })} className="rounded" />
            Son
          </label>
          {'Notification' in window && Notification.permission !== 'granted' && (
            <button onClick={() => Notification.requestPermission()} className="btn-secondary btn-sm w-full">
              <BellRing className="w-3.5 h-3.5" /> Activer les notifications
            </button>
          )}
        </div>
      )}

      {isDue ? (
        <div className="card p-4 w-80 shadow-lg border-2 border-primary-500 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-10 h-10 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0 animate-pulse">
              <AlarmClock className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">C&apos;est l&apos;heure de poster un reel</p>
              <p className="text-xs text-gray-500">
                {data.today.posts}/{data.targets.reel} aujourd&apos;hui
                {minutes != null && ` · dernier post il y a ${minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`}`}
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => posted.mutate()} disabled={posted.isPending} className="btn-primary btn-sm flex-1">
              <Check className="w-3.5 h-3.5" /> {posted.isPending ? 'Vérification…' : 'J\'ai posté'}
            </button>
            <button onClick={() => snooze(10)} className="btn-secondary btn-sm">Dans 10 min</button>
            <button onClick={() => setShowSettings((v) => !v)} className="btn-secondary btn-sm px-2" title="Réglages">
              <Settings2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setShowSettings((v) => !v)}
          className="card px-3 py-1.5 shadow-sm text-xs text-gray-600 flex items-center gap-1.5 hover:bg-gray-50">
          <AlarmClock className="w-3.5 h-3.5 text-primary-600" />
          {settings.enabled && due ? `Prochain reel à ${fmtTime(due)}` : 'Alarme désactivée'}
          <span className="text-gray-400">· {data.today.posts}/{data.targets.reel}</span>
        </button>
      )}
    </div>
  );
}
