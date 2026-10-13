-- Sprint 32 — Phase 4 : captation inbound Instagram (commentaires + DM → leads).
-- La synchro lit les commentaires des contenus récents et les conversations du
-- compte ; un commentaire contenant un mot-clé ou une nouvelle conversation
-- ouverte par un prospect crée (ou rattache) un lead inbound attribué au contenu.
-- ⚠️ En mode Développement, Meta ne renvoie que les commentaires/DM des comptes
-- ayant un rôle dans l'app : la captation réelle démarre après l'App Review.

CREATE TABLE IF NOT EXISTS ig_comments (
  id               text PRIMARY KEY,          -- id du commentaire Instagram
  content_id       uuid REFERENCES ig_content(id) ON DELETE CASCADE,
  ig_media_id      text NOT NULL,
  account_username text NOT NULL,
  username         text,
  text             text,
  commented_at     timestamptz,
  keyword          text,                      -- mot-clé détecté (null = commentaire simple)
  lead_id          uuid REFERENCES leads(id) ON DELETE SET NULL,
  replied_at       timestamptz,               -- réponse privée automatique envoyée
  reply_error      text,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ig_comments_media ON ig_comments (ig_media_id);
CREATE INDEX IF NOT EXISTS idx_ig_comments_created ON ig_comments (created_at DESC);

CREATE TABLE IF NOT EXISTS ig_conversations (
  id                   text PRIMARY KEY,      -- id de la conversation Instagram
  account_username     text NOT NULL,
  participant_id       text,
  participant_username text,
  channel              text,                  -- dm_inbound | story_reply | outbound
  first_message_at     timestamptz,
  last_message_at      timestamptz,
  lead_id              uuid REFERENCES leads(id) ON DELETE SET NULL,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_ig_conversations_created ON ig_conversations (created_at DESC);

-- Réglages par compte : mots-clés de CTA et réponse privée automatique.
CREATE TABLE IF NOT EXISTS inbound_settings (
  account_username text PRIMARY KEY,
  keywords         text[] NOT NULL DEFAULT ARRAY['BTP', 'AUDIT'],
  auto_reply_text  text,                      -- null = pas de réponse automatique
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO inbound_settings (account_username) VALUES ('lomig_guegueniat')
ON CONFLICT (account_username) DO NOTHING;
