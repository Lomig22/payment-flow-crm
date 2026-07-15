-- Sprint 14 — Opération Show-Up : mail-passerelle
-- Trace l'envoi du mail de confirmation (bouton « Confirmer sur WhatsApp »)
-- depuis la fiche lead. Nécessaire aux KPIs : taux de confirmation, délai appel→RDV.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS confirmation_email_sent_at timestamptz;
