-- Sprint 31 — Légendes rédigées par Claude à partir des images de la vidéo.
-- À l'upload, 6 images sont extraites de la vidéo (Storage : frames/<id>-<n>.jpg,
-- supprimées après publication) ; Claude écrit légende + hashtags.
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS frame_paths text[];
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS caption_ai  jsonb;   -- { hashtags, place_guess, subject }
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS caption_source text
  CHECK (caption_source IN ('manual', 'ai', 'ai_edited'));
