-- Couverture des reels (17/10/2026) : image envoyée à Instagram avec la vidéo (cover_url) au lieu de la
-- première image. Utilisée pour les reels de la fabrique @paymentflow (couverture standardisée).
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS cover_url text;
