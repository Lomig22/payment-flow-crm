'use client';
import { useEffect, useState, useCallback, useRef } from 'react';
import { Clock, LogIn, LogOut, Loader2 } from 'lucide-react';
import { shiftsApi } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';

const SHIFT_KEY = 'pf_shift_id';
const SHIFT_DATE_KEY = 'pf_shift_date';

function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ── Début de shift modal ─────────────────────────────────────────── */
function StartModal({ onStarted }: { onStarted: (id: string) => void }) {
  const [loading, setLoading] = useState(false);
  const [time, setTime] = useState('');

  useEffect(() => {
    const tick = () => setTime(new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }));
    tick();
    const t = setInterval(tick, 1000);
    return () => clearInterval(t);
  }, []);

  const handleStart = async () => {
    setLoading(true);
    try {
      const { data } = await shiftsApi.start();
      localStorage.setItem(SHIFT_KEY, data.id);
      localStorage.setItem(SHIFT_DATE_KEY, today());
      onStarted(data.id);
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden">
        <div className="bg-indigo-600 px-6 py-8 text-center">
          <Clock className="w-12 h-12 text-white mx-auto mb-3 opacity-90" />
          <p className="text-white/80 text-sm font-medium uppercase tracking-wider">Payment Flow CRM</p>
          <p className="text-white text-4xl font-bold mt-1">{time}</p>
        </div>
        <div className="p-6 text-center">
          <h2 className="text-xl font-bold text-gray-900 mb-1">Bonne journée ! 👋</h2>
          <p className="text-sm text-gray-500 mb-6">
            Clique sur le bouton ci-dessous pour enregistrer le début de ton shift.
          </p>
          <button
            onClick={handleStart}
            disabled={loading}
            className="btn-primary w-full justify-center py-3 text-base"
          >
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : <LogIn className="w-5 h-5" />
            }
            Début de shift
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Fin de shift modal ───────────────────────────────────────────── */
export function EndShiftModal({
  shiftId,
  onConfirmed,
  onCancel,
}: {
  shiftId: string;
  onConfirmed: () => void;
  onCancel: () => void;
}) {
  const [loading, setLoading] = useState(false);

  const handleEnd = async () => {
    setLoading(true);
    try {
      await shiftsApi.end(shiftId);
      localStorage.removeItem(SHIFT_KEY);
      localStorage.removeItem(SHIFT_DATE_KEY);
      onConfirmed();
    } catch {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 text-center">
        <div className="w-14 h-14 bg-orange-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <LogOut className="w-7 h-7 text-orange-600" />
        </div>
        <h2 className="text-xl font-bold text-gray-900 mb-1">Fin de shift</h2>
        <p className="text-sm text-gray-500 mb-6">
          Confirmes-tu la fin de ta journée de travail ? Ton temps sera enregistré.
        </p>
        <div className="flex gap-3">
          <button onClick={onCancel} className="btn-secondary flex-1 justify-center">
            Annuler
          </button>
          <button onClick={handleEnd} disabled={loading} className="btn-primary flex-1 justify-center">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogOut className="w-4 h-4" />}
            Terminer
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Main guard ───────────────────────────────────────────────────── */
export default function ShiftGuard() {
  const user = useAuthStore((s) => s.user);
  const [showStart, setShowStart]   = useState(false);
  const [showEnd,   setShowEnd]     = useState(false);
  const [shiftId,   setShiftId]     = useState<string | null>(null);
  const [mounted,   setMounted]     = useState(false);
  const endingRef = useRef(false);

  // Listen for "end shift" trigger dispatched by the Header button
  useEffect(() => {
    const handler = () => { if (shiftId) setShowEnd(true); };
    window.addEventListener('pf:shift:end', handler);
    return () => window.removeEventListener('pf:shift:end', handler);
  }, [shiftId]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !user) return;

    const storedId   = localStorage.getItem(SHIFT_KEY);
    const storedDate = localStorage.getItem(SHIFT_DATE_KEY);

    if (storedId && storedDate === today()) {
      // Already clocked in today
      setShiftId(storedId);
    } else {
      // Clear stale shift data and show start modal
      localStorage.removeItem(SHIFT_KEY);
      localStorage.removeItem(SHIFT_DATE_KEY);
      setShowStart(true);
    }
  }, [mounted, user]);

  // beforeunload: send beacon to end shift when browser/tab closes
  useEffect(() => {
    if (!shiftId) return;

    const handleUnload = () => {
      if (endingRef.current) return;
      const token = localStorage.getItem('pf_token');
      if (!token) return;
      navigator.sendBeacon(
        '/api/shifts/end',
        new Blob(
          [JSON.stringify({ shift_id: shiftId })],
          { type: 'application/json' }
        )
      );
    };

    window.addEventListener('beforeunload', handleUnload);
    return () => window.removeEventListener('beforeunload', handleUnload);
  }, [shiftId]);

  const handleStarted = useCallback((id: string) => {
    setShiftId(id);
    setShowStart(false);
  }, []);

  const handleEndConfirmed = useCallback(() => {
    endingRef.current = true;
    setShiftId(null);
    setShowEnd(false);
    setShowStart(true);
  }, []);

  if (!mounted || !user) return null;

  return (
    <>
      {showStart && <StartModal onStarted={handleStarted} />}
      {showEnd && shiftId && (
        <EndShiftModal
          shiftId={shiftId}
          onConfirmed={handleEndConfirmed}
          onCancel={() => setShowEnd(false)}
        />
      )}
    </>
  );
}

/* Hook to trigger end-shift modal from any component */
export function useShiftEnd() {
  const triggerEnd = useCallback(() => {
    const event = new CustomEvent('pf:shift:end');
    window.dispatchEvent(event);
  }, []);
  return { triggerEnd };
}
