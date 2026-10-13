-- Sprint 21 — Statut « Non qualifié » (colonne pipeline Instagram/Facebook et
-- funnel cold call). leads.status et qualiopi_leads.status sont de type enum
-- lead_status : sans cette valeur, tout déplacement vers la colonne échouait.
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'not_qualified';
