-- Suivi et gabarits (15/10/2026)
-- « Vu » LinkedIn : premier accusé de lecture relevé dans la messagerie (taux d'ouverture)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_seen_at timestamptz;
-- Gabarits des messages LinkedIn modifiés par Lomig (onglet LinkedIn > Messages) ; vide = textes d'origine
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS msg_templates jsonb NOT NULL DEFAULT '{}'::jsonb;
