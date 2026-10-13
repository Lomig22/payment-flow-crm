-- Sprint 37 — Rattrapage YouTube des reels déjà publiés sur Instagram.
-- État par reel : { status: pending | done | skipped | failed, id, url, error, attempts, at }
-- (skipped = vidéo non fournie par l'API, ex. musique de la bibliothèque Instagram).
ALTER TABLE ig_content ADD COLUMN IF NOT EXISTS youtube jsonb;
