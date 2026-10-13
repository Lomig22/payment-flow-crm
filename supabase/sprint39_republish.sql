-- Sprint 39 — Republication des meilleurs reels : une entrée de la file peut être la
-- republication volontaire d'un reel déjà publié (ig_media_id d'origine). L'anti-doublon
-- l'autorise ; un même reel n'est republié qu'une fois.
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS republish_of text;
CREATE INDEX IF NOT EXISTS idx_content_queue_republish_of ON content_queue (republish_of) WHERE republish_of IS NOT NULL;
