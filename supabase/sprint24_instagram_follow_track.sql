-- Sprint 24 — Piste « follow d'abord » sur Instagram.
-- Deux pistes d'outreach, jamais sur les mêmes comptes :
--   • dm     : DM à froid direct (Lead → M1 → R1 → R2…)            — existant
--   • follow : À follow → Follow envoyé → Follow back → DM (M1…)    — nouveau
-- Les follows sont faits à la main ; le CRM les compte (100/jour/compte max).

-- Statuts du funnel follow (enum lead_status, cf. mémoire lead-status-enum)
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'to_follow';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'followed';
ALTER TYPE lead_status ADD VALUE IF NOT EXISTS 'followed_back';

ALTER TABLE leads ADD COLUMN IF NOT EXISTS ig_outreach text NOT NULL DEFAULT 'dm';
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_ig_outreach_check;
ALTER TABLE leads ADD CONSTRAINT leads_ig_outreach_check CHECK (ig_outreach IN ('dm', 'follow'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS followed_at      timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS followed_back_at timestamptz;

-- Un compte Instagram = un seul lead, toutes pistes et sources confondues.
CREATE UNIQUE INDEX IF NOT EXISTS leads_instagram_username_uniq
  ON leads (lower(trim(both '@ ' from instagram_username)))
  WHERE instagram_username IS NOT NULL AND trim(both '@ ' from instagram_username) <> '';

-- Journal des actions : DM (existant) et follows (quota quotidien).
ALTER TABLE instagram_dm_log ADD COLUMN IF NOT EXISTS action text NOT NULL DEFAULT 'dm';
ALTER TABLE instagram_dm_log DROP CONSTRAINT IF EXISTS instagram_dm_log_action_check;
ALTER TABLE instagram_dm_log ADD CONSTRAINT instagram_dm_log_action_check CHECK (action IN ('dm', 'follow'));
