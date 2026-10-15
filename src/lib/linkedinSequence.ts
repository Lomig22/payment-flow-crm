import { TEMPLATE_DEFAULTS } from '@/lib/linkedinTemplates';

// Séquence LinkedIn : premier message puis 1 à 16 relances (R1 … R16), chacune avec son délai
// (jours ouvrés après le message précédent) et son texte selon la question posée (Q1 / Q2).
// Réglée dans l'onglet LinkedIn > Messages (linkedin_settings.relances) ; vide = R1 / R2 / R3 d'origine.

export const MAX_RELANCES = 16;
export interface Relance { delay_days: number; cout_client: string; regularite: string }

// R1 / R2 / R3 d'origine (délais historiques comptés depuis le premier message → convertis)
export function defaultRelances(s: { r1_days?: number; r2_days?: number; r3_days?: number }): Relance[] {
  const d1 = s.r1_days ?? 3, d2 = s.r2_days ?? 7, d3 = s.r3_days ?? 14;
  return [
    { delay_days: d1, cout_client: TEMPLATE_DEFAULTS.r1_cout_client, regularite: TEMPLATE_DEFAULTS.r1_regularite },
    { delay_days: Math.max(1, d2 - d1), cout_client: TEMPLATE_DEFAULTS.r2_cout_client, regularite: TEMPLATE_DEFAULTS.r2_regularite },
    { delay_days: Math.max(1, d3 - d2), cout_client: TEMPLATE_DEFAULTS.r3, regularite: TEMPLATE_DEFAULTS.r3 },
  ];
}

export function relancesOf(s: { relances?: Relance[] | null; r1_days?: number; r2_days?: number; r3_days?: number }): Relance[] {
  const list = Array.isArray(s.relances) ? s.relances.filter((r) => r && (r.cout_client?.trim() || r.regularite?.trim())) : [];
  return (list.length ? list : defaultRelances(s)).slice(0, MAX_RELANCES);
}

// Statut ↔ rang : first_sent = 0, r1_sent = 1 … ; -1 hors séquence de messages
export function stageOfStatus(status: string | null | undefined): number {
  if (status === 'first_sent') return 0;
  const m = /^r(\d{1,2})_sent$/.exec(status ?? '');
  return m ? Number(m[1]) : -1;
}
export const statusOfStage = (k: number) => (k === 0 ? 'first_sent' : `r${k}_sent`);
export const stageName = (k: number) => (k === 0 ? 'first' : `r${k}`);
export function stageIndex(stage: string | null | undefined): number {
  if (stage === 'first') return 0;
  const m = /^r(\d{1,2})$/.exec(stage ?? '');
  return m ? Number(m[1]) : -1;
}
// Tous les statuts « message envoyé » possibles (jusqu'à R16)
export const MESSAGED_STATUSES = Array.from({ length: MAX_RELANCES + 1 }, (_, k) => statusOfStage(k));
