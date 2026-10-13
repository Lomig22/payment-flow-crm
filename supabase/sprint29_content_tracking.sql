-- Sprint 29 — Contenu Instagram inbound (roadmap personal brand @lomig_guegueniat).
-- Les publications (reels, stories, posts) sont importées automatiquement depuis
-- l'API Instagram avec leurs statistiques ; les objectifs de publication par jour
-- servent au compteur « Aujourd'hui » ; les leads gardent leur origine inbound.

-- Token de l'API Instagram par compte : le token longue durée (60 jours) est
-- rafraîchi par la synchro et stocké ici (une variable Vercel ne peut pas être
-- réécrite à l'exécution). Lu uniquement avec la clé service.
CREATE TABLE IF NOT EXISTS instagram_tokens (
  account_username text PRIMARY KEY,
  ig_user_id       text NOT NULL,
  access_token     text NOT NULL,
  expires_at       timestamptz,
  refreshed_at     timestamptz NOT NULL DEFAULT now(),
  last_sync_at     timestamptz,
  last_sync_error  text
);
ALTER TABLE instagram_tokens ENABLE ROW LEVEL SECURITY;

-- Une publication Instagram et ses dernières statistiques connues.
CREATE TABLE IF NOT EXISTS ig_content (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ig_media_id        text NOT NULL UNIQUE,
  account_username   text NOT NULL,
  format             text NOT NULL CHECK (format IN ('reel', 'story', 'post', 'carousel')),
  permalink          text,
  caption            text,
  thumbnail_url      text,
  published_at       timestamptz NOT NULL,
  target_audience    text NOT NULL DEFAULT 'artisans',
  pillar             text,           -- attirer / prouver / convertir / engager
  views              integer,
  reach              integer,
  likes              integer,
  comments           integer,
  shares             integer,
  saved              integer,
  replies            integer,        -- stories
  profile_visits     integer,        -- stories
  follows            integer,        -- stories
  total_interactions integer,
  avg_watch_time_ms  integer,        -- reels
  metrics_updated_at timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ig_content_published ON ig_content (account_username, published_at DESC);

-- Historique des relevés (courbe de performance H+1, J+1, J+7…).
CREATE TABLE IF NOT EXISTS ig_content_metrics (
  id                 bigserial PRIMARY KEY,
  content_id         uuid NOT NULL REFERENCES ig_content(id) ON DELETE CASCADE,
  captured_at        timestamptz NOT NULL DEFAULT now(),
  views              integer,
  reach              integer,
  likes              integer,
  comments           integer,
  shares             integer,
  saved              integer,
  total_interactions integer
);
CREATE INDEX IF NOT EXISTS idx_ig_content_metrics ON ig_content_metrics (content_id, captured_at);

-- Statistiques du compte par jour (jour Instagram, heure du Pacifique).
CREATE TABLE IF NOT EXISTS ig_account_daily (
  account_username   text NOT NULL,
  day                date NOT NULL,
  views              integer,
  reach              integer,
  profile_views      integer,
  accounts_engaged   integer,
  total_interactions integer,
  website_clicks     integer,
  followers_total    integer,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_username, day)
);

-- Objectifs de publication par compte et par format.
CREATE TABLE IF NOT EXISTS content_targets (
  account_username text NOT NULL,
  format           text NOT NULL CHECK (format IN ('reel', 'story', 'post', 'carousel')),
  per_day          integer NOT NULL CHECK (per_day >= 0),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_username, format)
);

INSERT INTO content_targets (account_username, format, per_day) VALUES
  ('lomig_guegueniat', 'reel', 10),
  ('lomig_guegueniat', 'story', 3)
ON CONFLICT (account_username, format) DO NOTHING;

-- Origine des leads : outbound (prospection) ou inbound (le lead vient à nous),
-- canal inbound et contenu qui l'a amené.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origin text
  CHECK (origin IN ('outbound', 'inbound'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS inbound_channel text
  CHECK (inbound_channel IN ('comment_keyword', 'dm_inbound', 'story_reply', 'link_bio', 'other'));
ALTER TABLE leads ADD COLUMN IF NOT EXISTS origin_content_id uuid
  REFERENCES ig_content(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_leads_origin_content ON leads (origin_content_id) WHERE origin_content_id IS NOT NULL;
