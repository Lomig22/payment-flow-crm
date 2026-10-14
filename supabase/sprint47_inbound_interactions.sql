-- Sprint 47 — Inbound : toutes les interactions au même endroit (demande de Lomig du 14/10/2026)
-- Commentaires Instagram et Facebook, abonnements (import de l'export officiel Instagram), DM.
-- Chaque commentaire est rapproché du mot-clé de SON reel (« Commente « SIMULATEUR » … » dans la
-- légende) et des mots-clés généraux ; sinon Claude juge s'il exprime un intérêt (« en périphérie »).
-- Mot-clé ou intérêt → lead inbound + e-mail à Lomig.
CREATE TABLE IF NOT EXISTS inbound_interactions (
  id               text PRIMARY KEY,               -- ig:<commentaire> | fb:<commentaire> | follow:ig:<pseudo> | dm:ig:<conversation>
  platform         text NOT NULL CHECK (platform IN ('instagram', 'facebook')),
  kind             text NOT NULL CHECK (kind IN ('comment', 'follow', 'dm', 'story_reply')),
  content_queue_id uuid REFERENCES content_queue(id) ON DELETE SET NULL,
  media_ref        text,                           -- id du média Instagram ou de la vidéo Facebook
  permalink        text,                           -- lien vers le commentaire ou le contenu
  content_caption  text,                           -- première ligne de la légende du contenu
  author_name      text,
  author_handle    text,                           -- pseudo Instagram
  author_id        text,
  text             text,
  keyword          text,                           -- mot-clé trouvé dans le commentaire
  intent           text CHECK (intent IN ('keyword', 'interest', 'other')),
  intent_reason    text,
  lead_id          uuid REFERENCES leads(id) ON DELETE SET NULL,
  status           text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'handled', 'ignored')),
  occurred_at      timestamptz,
  notified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS inbound_interactions_occurred_idx ON inbound_interactions (occurred_at DESC);
CREATE INDEX IF NOT EXISTS inbound_interactions_status_idx ON inbound_interactions (status, intent);

-- État de la captation par plateforme (dernière synchro, dernière erreur), affiché sur /inbound
ALTER TABLE inbound_settings ADD COLUMN IF NOT EXISTS ig_last_sync_at timestamptz;
ALTER TABLE inbound_settings ADD COLUMN IF NOT EXISTS ig_last_error   text;
ALTER TABLE inbound_settings ADD COLUMN IF NOT EXISTS fb_last_sync_at timestamptz;
ALTER TABLE inbound_settings ADD COLUMN IF NOT EXISTS fb_last_error   text;
ALTER TABLE inbound_settings ADD COLUMN IF NOT EXISTS classify_interest boolean NOT NULL DEFAULT true;

-- Mots-clés généraux : ceux des CTA déjà utilisés, SIMULATEUR compris
UPDATE inbound_settings SET keywords = ARRAY(SELECT DISTINCT unnest(keywords || ARRAY['SIMULATEUR', 'DEVIS'])) WHERE account_username = 'lomig_guegueniat';

