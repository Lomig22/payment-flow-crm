-- Sprint 44 — Séquence LinkedIn v2 (cahier des charges de Lomig du 12/10/2026)
--   • import CSV Hermès (poste, SIREN, site, secteur…) ;
--   • invitations avec montée en charge (5 → 10 → 15 → 20 / jour, 100 / semaine glissante),
--     retrait des invitations en attente depuis 21 jours ;
--   • premier message rédigé par un agent à partir du profil (variante A post / B profil / C modèle,
--     question Q1 « cout_client » ou Q2 « regularite »), validation manuelle des 50 premiers ;
--   • relances R1 / R2 / R3 (J+3 / J+7 / J+14 ouvrés) ou relance « post » ;
--   • arrêt à la première réponse (statut « à reprendre »), « ne plus contacter ».
-- Statuts (leads.li_status) :
--   to_invite → invited → (expired) → connected → to_validate → ready → first_sent → r1_sent →
--   r2_sent → r3_sent → no_reply ; à tout moment to_resume / dnc / failed.

-- ── Fiche lead : champs du CSV Hermès ──
ALTER TABLE leads ADD COLUMN IF NOT EXISTS job_title text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS siren     text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS website   text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_sector text;     -- agence_immo | renovation_energetique | cuisiniste | piscine_paysage | menuiserie
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_import jsonb;    -- { source, date_sourcing, departement } du CSV

-- ── Ne plus contacter (le lead et son entreprise) ──
ALTER TABLE leads ADD COLUMN IF NOT EXISTS do_not_contact    boolean NOT NULL DEFAULT false;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS do_not_contact_at timestamptz;

-- ── Séquence ──
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_question     text;          -- cout_client | regularite
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_msg          jsonb;         -- sortie de l'agent pour le premier message
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_pending      jsonb;         -- prochain message : { stage, kind, message, … }
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_profile      jsonb;         -- profil + 5 dernières publications
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_profile_at   timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_due_at       timestamptz;   -- prochaine échéance (message, relance, fin)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_last_sent_at timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_last_kind    text;          -- first | r1 | r2 | r3 | post
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_replied_at   timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_reply_text   text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_thread_url   text;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_handled_at   timestamptz;   -- « à reprendre » traité par Lomig
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_expired_at   timestamptz;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_preview      boolean NOT NULL DEFAULT false;  -- test : message généré, jamais envoyé

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_li_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_li_status_check CHECK (
  li_status IS NULL OR li_status IN ('to_invite','invited','expired','connected','to_validate','ready',
    'first_sent','r1_sent','r2_sent','r3_sent','no_reply','to_resume','dnc','failed')
);

CREATE INDEX IF NOT EXISTS leads_li_status_idx ON leads (li_status) WHERE li_status IS NOT NULL;
CREATE INDEX IF NOT EXISTS leads_siren_idx ON leads (siren) WHERE siren IS NOT NULL;

-- Ancien test A/B/C (lettres tirées au sort) : la variante est désormais choisie par l'agent
UPDATE leads SET li_variant = NULL WHERE li_status IN ('to_invite', 'invited');

-- ── Réglages ──
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS ramp               jsonb   NOT NULL DEFAULT '[5,10,15,20]'::jsonb;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS ramp_started_at    timestamptz;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS weekly_invite_cap  integer NOT NULL DEFAULT 100;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS max_gap_minutes    integer NOT NULL DEFAULT 9;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS invite_expiry_days integer NOT NULL DEFAULT 21;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS first_msg_min_hours integer NOT NULL DEFAULT 2;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS first_msg_max_hours integer NOT NULL DEFAULT 24;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS r1_days            integer NOT NULL DEFAULT 3;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS r2_days            integer NOT NULL DEFAULT 7;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS r3_days            integer NOT NULL DEFAULT 14;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS end_days           integer NOT NULL DEFAULT 5;   -- après R3, jours ouvrés avant « sans réponse »
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS inbox_every_minutes integer NOT NULL DEFAULT 45;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS manual_validation  boolean NOT NULL DEFAULT true;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS validation_target  integer NOT NULL DEFAULT 50;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS validated_count    integer NOT NULL DEFAULT 0;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS last_inbox_at      timestamptz;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS stop_reason        text;      -- arrêt de sécurité : ne repart qu'à la main
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS stopped_at         timestamptz;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS last_question      text;      -- alternance Q1 / Q2

UPDATE linkedin_settings SET weekdays_only = true, work_start_hour = 9, work_end_hour = 19, dms_per_day = 20 WHERE id = 1;

-- ── Journal : nouvelles actions (visite de profil, publications, messagerie, retrait…) ──
ALTER TABLE linkedin_log DROP CONSTRAINT IF EXISTS linkedin_log_action_check;
ALTER TABLE linkedin_log ADD COLUMN IF NOT EXISTS stage text;   -- message envoyé : first | r1 | r2 | r3 | post

-- ── Source « linkedin » (leads Hermès) ──
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check CHECK (source = ANY (ARRAY['instagram','facebook','cold_call','sea_ads','linkedin']));
UPDATE leads SET source = 'linkedin', origin = 'outbound' WHERE source IS NULL AND linkedin_url IS NOT NULL AND linkedin_url <> '';
