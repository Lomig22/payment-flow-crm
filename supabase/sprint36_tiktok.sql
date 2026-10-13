-- Sprint 36 — Cross-post TikTok : la table des jetons de plateformes accepte 'tiktok'.
--   tiktok : { open_id, access_token, access_expires_at, refresh_token, display_name, enabled }
ALTER TABLE platform_tokens DROP CONSTRAINT IF EXISTS platform_tokens_platform_check;
ALTER TABLE platform_tokens ADD CONSTRAINT platform_tokens_platform_check
  CHECK (platform IN ('facebook', 'youtube', 'tiktok'));
