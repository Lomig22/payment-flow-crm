-- Sprint 15 — Opération Show-Up : relances automatiques avant RDV
-- Anti-doublon des relances envoyées par le cron /api/cron/reminders.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_j1_sent_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS reminder_h2_sent_at timestamptz;
