-- Sprint 22 — Compte d'envoi des DM Instagram + avancement auto du funnel.
-- Chaque clic « ouvrir les DM » depuis le CRM est journalisé avec le compte
-- d'envoi sélectionné (compteur quotidien par compte) et le lead garde le
-- dernier compte utilisé (relancer depuis le même compte).

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS last_dm_account_id uuid
  REFERENCES social_accounts(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS instagram_dm_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES social_accounts(id) ON DELETE SET NULL,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  from_status text,
  to_status   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_instagram_dm_log_created_at ON instagram_dm_log (created_at);
CREATE INDEX IF NOT EXISTS idx_instagram_dm_log_account    ON instagram_dm_log (account_id, created_at);
