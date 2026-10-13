-- Sprint 46 — Montée en charge intelligente LinkedIn (cahier des charges de Lomig du 13/10/2026)
--   • paliers configurables (10-12 → 15 → 20 → 25 / jour), passage selon l'ancienneté au palier
--     et le taux d'acceptation des invitations de plus de 7 jours, redescente sous 25 % ;
--   • plafond 100 invitations / 7 jours glissants (+25 % au dernier palier) ;
--   • fenêtre 9 h – 18 h 30 avec pause déjeuner, envois répartis en 2 ou 3 sessions par jour,
--     volume du jour ±20 % autour de la cible, délai de 3 à 12 min entre deux invitations ;
--   • états du compte ACTIF / COOLDOWN (7 jours, −2 paliers, reprise seule) / BLOQUÉ (manuel) ;
--   • invitations en attente : compteur LinkedIn, suspension au-delà de 1 000, retrait des plus anciennes ;
--   • test de l'invitation : sans note / avec note (texte par secteur), 50/50 ;
--   • visite des profils 1 à 2 jours avant l'invitation, repérage des Open Profile.
-- Tous les paramètres sont dans linkedin_settings, modifiables depuis /linkedin sans redéploiement.

ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS tiers               jsonb   NOT NULL DEFAULT '[{"min":10,"max":12},{"min":15,"max":15},{"min":20,"max":20},{"min":25,"max":25}]'::jsonb;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS tier                integer NOT NULL DEFAULT 1;   -- palier actuel (1 = warm-up)
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS tier_since          timestamptz;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS promote_min_days    integer NOT NULL DEFAULT 7;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS promote_rate        integer NOT NULL DEFAULT 30;  -- % pour monter
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS promote_rate_last   integer NOT NULL DEFAULT 35;  -- % pour monter au dernier palier
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS demote_rate         integer NOT NULL DEFAULT 25;  -- % sous lequel on redescend
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS rate_min_sample     integer NOT NULL DEFAULT 15;  -- invitations mûres minimum pour juger
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS last_tier_bonus_pct integer NOT NULL DEFAULT 25;  -- plafond 7 j +25 % au dernier palier
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS volume_jitter_pct   integer NOT NULL DEFAULT 20;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS day_start_min       integer NOT NULL DEFAULT 540;   -- 9 h 00
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS day_end_min         integer NOT NULL DEFAULT 1110;  -- 18 h 30
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS lunch_start_min     integer NOT NULL DEFAULT 750;   -- 12 h 30
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS lunch_end_min       integer NOT NULL DEFAULT 825;   -- 13 h 45
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS invite_gap_min      integer NOT NULL DEFAULT 3;     -- minutes entre deux invitations
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS invite_gap_max      integer NOT NULL DEFAULT 12;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS sessions_min        integer NOT NULL DEFAULT 2;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS sessions_max        integer NOT NULL DEFAULT 3;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS day_plan            jsonb;                          -- plan du jour : cible, sessions
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS account_state       text    NOT NULL DEFAULT 'active';  -- active | cooldown | blocked
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS cooldown_until      timestamptz;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS cooldown_days       integer NOT NULL DEFAULT 7;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS cooldown_tier_drop  integer NOT NULL DEFAULT 2;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS error_streak        integer NOT NULL DEFAULT 0;     -- erreurs consécutives
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS error_streak_max    integer NOT NULL DEFAULT 5;     -- au-delà : cooldown
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS pending_cap         integer NOT NULL DEFAULT 1500;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS pending_suspend     integer NOT NULL DEFAULT 1000;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS pending_count       integer;                        -- invitations en attente lues sur LinkedIn
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS pending_count_at    timestamptz;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS sent_withdraw_per_day integer NOT NULL DEFAULT 40;   -- retraits des anciennes invitations (page « Envoyées »)
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS reinvite_block_days integer NOT NULL DEFAULT 30;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS note_split_pct      integer NOT NULL DEFAULT 50;    -- % d'invitations avec note
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS note_templates      jsonb   NOT NULL DEFAULT '{}'::jsonb;  -- { secteur | "default": texte }
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS previsit_enabled    boolean NOT NULL DEFAULT true;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS worker_id           text;                           -- seule session autorisée
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS worker_ip           text;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS worker_proxy        boolean;
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS worker_ips          jsonb   NOT NULL DEFAULT '[]'::jsonb;  -- IP vues (7 derniers jours)

-- Démarrage : palier 1 depuis l'activation de la séquence
UPDATE linkedin_settings SET tier_since = coalesce(ramp_started_at, now()) WHERE id = 1 AND tier_since IS NULL;

-- Prospects : variante d'invitation, Open Profile, visite préalable
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_inv_variant text;          -- no_note | note
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_inv_note    text;          -- note envoyée avec l'invitation
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_open_profile boolean;      -- bouton « Message » sans être en relation
ALTER TABLE leads ADD COLUMN IF NOT EXISTS li_visited_at  timestamptz;   -- visite du profil avant l'invitation

-- Événements du compte (paliers, cooldown, blocage, reprises) : historique affiché sur /linkedin
CREATE TABLE IF NOT EXISTS linkedin_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL,          -- tier_up | tier_down | tier_forced | cooldown | blocked | resumed | unblocked | pending_suspend | note_unavailable
  detail     text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS linkedin_events_created_idx ON linkedin_events (created_at DESC);
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS tier_reason text;   -- dernière évaluation du palier (affichée sur /linkedin)
