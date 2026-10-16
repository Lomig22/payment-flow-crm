'use client';
import { useCallback, useEffect, useRef, useState } from 'react';

// Enregistrement automatique d'un formulaire (modèles de mails, messages LinkedIn) : 1,5 s après la
// dernière frappe, et aussitôt quand on quitte l'onglet, la fenêtre ou la page. Tant qu'il reste des
// modifications non enregistrées, le navigateur demande confirmation avant de fermer l'onglet.
export type AutosaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

export function useAutosave<T>(value: T | null, save: (v: T) => Promise<unknown>, opts: { delay?: number; ready?: boolean; blockedReason?: string | null } = {}) {
  const { delay = 1500, ready = true, blockedReason = null } = opts;
  const [status, setStatus] = useState<AutosaveStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(value), saved = useRef<string | null>(null), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef<Promise<unknown> | null>(null);
  latest.current = value;

  const key = (v: T | null) => JSON.stringify(v);
  // Premier état chargé = état enregistré (rien à sauvegarder)
  useEffect(() => { if (ready && value !== null && saved.current === null) saved.current = key(value); }, [ready, value]);

  const flush = useCallback(async () => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null; }
    const v = latest.current;
    if (v === null || saved.current === null || key(v) === saved.current || blockedReason) return;
    const k = key(v);
    setStatus('saving');
    try {
      inFlight.current = save(v);
      await inFlight.current;
      saved.current = k;
      setError(null);
      setStatus(key(latest.current) === k ? 'saved' : 'dirty');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Erreur');
      setStatus('error');
    }
  }, [save, blockedReason]);

  // Modification : enregistrement différé
  useEffect(() => {
    if (!ready || value === null || saved.current === null || key(value) === saved.current) return;
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void flush(); }, delay);
  }, [value, ready, delay, flush]);

  // Onglet masqué, fenêtre quittée, page fermée ou changée : enregistrement immédiat
  useEffect(() => {
    const onHide = () => { if (document.visibilityState === 'hidden') void flush(); };
    const onBlur = () => { void flush(); };
    const onUnload = (e: BeforeUnloadEvent) => {
      if (latest.current !== null && saved.current !== null && key(latest.current) !== saved.current) {
        void flush();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);
    window.addEventListener('pagehide', onBlur);
    window.addEventListener('beforeunload', onUnload);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('pagehide', onBlur);
      window.removeEventListener('beforeunload', onUnload);
      void flush();   // navigation vers une autre page du CRM
    };
  }, [flush]);

  const label = blockedReason ? `Non enregistré : ${blockedReason}`
    : status === 'saving' ? 'Enregistrement…' : status === 'dirty' ? 'Modifications en cours…'
    : status === 'error' ? `Erreur d'enregistrement : ${error}` : status === 'saved' ? 'Enregistré automatiquement' : 'Enregistrement automatique';
  return { status, label, flush };
}
