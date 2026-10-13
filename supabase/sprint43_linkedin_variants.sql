-- Sprint 43 — Test A/B/C des messages LinkedIn (demandé par Lomig le 10/10/2026) :
-- trois lignes de messages (DM + relance), réparties à parts égales entre les leads, par métier,
-- pour mesurer celle qui obtient le plus de réponses.
--   • linkedin_settings.variants : [{ key: 'A', dm: '…', followup: '…' }, …]
--   • leads.li_variant           : lettre tirée pour le lead
--   • leads.li_replied_stage     : 'dm' (réponse avant la relance) ou 'followup' (après)
--   • leads.li_final_due_at      : dernière vérification, 5 jours après la relance
--   • li_status 'no_reply'       : relancé, toujours sans réponse à la dernière vérification

ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS variants jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS final_check_days integer NOT NULL DEFAULT 5;

ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_variant       text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_replied_stage text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_final_due_at  timestamptz;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_li_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_li_status_check CHECK (
  li_status IS NULL OR li_status IN ('to_invite','invited','connected','dm_sent','followup_sent','replied','no_reply','conversation','failed')
);

ALTER TABLE linkedin_log DROP CONSTRAINT IF EXISTS linkedin_log_action_check;
ALTER TABLE linkedin_log ADD CONSTRAINT linkedin_log_action_check CHECK (action IN ('invite','dm','followup','check','scan'));

-- Les trois lignes, pré-remplies avec les messages actuels (à remplacer par Lomig dans /linkedin)
UPDATE linkedin_settings SET variants = jsonb_build_array(
  jsonb_build_object('key', 'A', 'dm', message_template, 'followup', followup_template),
  jsonb_build_object('key', 'B', 'dm', message_template, 'followup', followup_template),
  jsonb_build_object('key', 'C', 'dm', message_template, 'followup', followup_template)
) WHERE id = 1 AND variants = '[]'::jsonb;

-- Tirage des leads déjà dans la séquence : A, B, C à tour de rôle à l'intérieur de chaque métier
WITH ranked AS (
  SELECT id, (row_number() OVER (PARTITION BY coalesce(niche, '') ORDER BY li_enqueued_at, id) - 1) % 3 AS r
  FROM leads WHERE li_status IS NOT NULL AND li_variant IS NULL
)
UPDATE leads l SET li_variant = (ARRAY['A','B','C'])[ranked.r + 1] FROM ranked WHERE l.id = ranked.id;
