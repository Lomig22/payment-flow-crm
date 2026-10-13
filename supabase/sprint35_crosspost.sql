-- Sprint 35 — Cross-post automatique des reels publiés sur Instagram vers la Page
-- Facebook Payment Flow (Reels) et la chaîne YouTube (Shorts).
-- Jetons d'accès par plateforme (lus uniquement avec la clé service) :
--   facebook : { page_id, page_name, access_token, enabled }
--   youtube  : { client_id, client_secret, refresh_token, channel_title, enabled }
CREATE TABLE IF NOT EXISTS platform_tokens (
  platform   text PRIMARY KEY CHECK (platform IN ('facebook', 'youtube')),
  data       jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE platform_tokens ENABLE ROW LEVEL SECURITY;

-- État du cross-post par vidéo : { facebook: { status, id, url, error, at }, youtube: { … } }
-- status : pending | done | failed. La vidéo reste dans Storage tant qu'un cross-post est en attente.
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS crosspost jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS idx_content_queue_crosspost_pending
  ON content_queue (published_at) WHERE crosspost::text LIKE '%pending%';
