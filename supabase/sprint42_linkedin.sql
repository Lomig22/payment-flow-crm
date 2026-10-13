-- Sprint 42 — Séquence LinkedIn (demandée par Lomig le 08/10/2026) :
--   1. on invite le lead sur LinkedIn,
--   2. quand il accepte l'invitation, on attend dm_delay_hours (24 h),
--   3. puis le DM part automatiquement ;
--   4. sans réponse au bout de followup_delay_hours (48 h), une relance part.
-- Les actions sont exécutées sur la session LinkedIn de Lomig, soit par le worker du VPS
-- (scripts/linkedin-worker), soit par l'extension Chrome (scripts/linkedin-extension) ;
-- le CRM décide quoi faire et quand.
--
-- li_status est une colonne à part (text + CHECK) : elle ne touche ni au statut principal
-- ni à la source du lead, donc n'importe quel lead du CRM peut entrer dans la séquence.

ALTER TABLE leads ADD COLUMN IF NOT EXISTS linkedin_url    text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_status       text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_enqueued_at  timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_invited_at   timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_connected_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_dm_due_at    timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_dm_sent_at   timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_followup_due_at  timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_followup_sent_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_attempts     integer NOT NULL DEFAULT 0;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_error        text;

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_li_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_li_status_check CHECK (
  li_status IS NULL OR li_status IN ('to_invite','invited','connected','dm_sent','followup_sent','replied','conversation','failed')
);
CREATE INDEX IF NOT EXISTS leads_li_status_idx ON leads (li_status) WHERE li_status IS NOT NULL;

-- Réglages (une seule ligne, id = 1). Désactivé par défaut : rien ne part tant que
-- le message n'a pas été relu et la séquence activée depuis la page LinkedIn.
CREATE TABLE IF NOT EXISTS linkedin_settings (
  id               integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  enabled          boolean NOT NULL DEFAULT false,
  ext_key          text    NOT NULL DEFAULT replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  message_template text    NOT NULL DEFAULT 'Hello {prenom}, merci d''avoir accepté l''invitation !',
  invites_per_day  integer NOT NULL DEFAULT 15,
  dms_per_day      integer NOT NULL DEFAULT 20,
  dm_delay_hours   integer NOT NULL DEFAULT 24,
  followup_enabled boolean NOT NULL DEFAULT true,
  followup_template text   NOT NULL DEFAULT 'Hello {prenom}, je me permets de te relancer : est-ce que tu as vu mon message ?',
  followup_delay_hours integer NOT NULL DEFAULT 48,
  work_start_hour  integer NOT NULL DEFAULT 9,
  work_end_hour    integer NOT NULL DEFAULT 19,
  weekdays_only    boolean NOT NULL DEFAULT true,
  min_gap_minutes  integer NOT NULL DEFAULT 4,
  next_action_at   timestamptz,
  last_scan_at     timestamptz,
  last_seen_at     timestamptz,
  alert            text,          -- problème bloquant (session LinkedIn déconnectée, limite hebdo…)
  alert_at         timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO linkedin_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;

-- Journal des actions de l'extension (plafonds journaliers + historique)
CREATE TABLE IF NOT EXISTS linkedin_log (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id    uuid REFERENCES leads(id) ON DELETE SET NULL,
  action     text NOT NULL CHECK (action IN ('invite','dm','followup','scan')),
  result     text NOT NULL,
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS linkedin_log_created_idx ON linkedin_log (created_at DESC);
