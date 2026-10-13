-- Sprint 30 — File de publication Instagram (phase 3 de la roadmap inbound).
-- Une vidéo est envoyée directement dans Supabase Storage (bucket content-media),
-- nettoyée de ses métadonnées sans réencodage (preuve : empreintes identiques),
-- puis publiée automatiquement à l'heure prévue par la tâche cron de synchro.

-- Bucket public : l'API Instagram télécharge la vidéo depuis une URL publique.
-- Les fichiers sont supprimés après publication (quota de stockage).
INSERT INTO storage.buckets (id, name, public)
VALUES ('content-media', 'content-media', true)
ON CONFLICT (id) DO UPDATE SET public = true;

CREATE TABLE IF NOT EXISTS content_queue (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username text NOT NULL,
  format           text NOT NULL CHECK (format IN ('reel', 'story')),
  caption          text,
  target_audience  text NOT NULL DEFAULT 'artisans',
  pillar           text,
  -- uploading → (nettoyage) → draft | scheduled → publishing → published | failed
  status           text NOT NULL DEFAULT 'uploading'
                   CHECK (status IN ('uploading', 'draft', 'scheduled', 'publishing', 'published', 'failed')),
  scheduled_at     timestamptz,
  file_name        text,
  file_size        bigint,
  storage_path     text,           -- vidéo nettoyée (supprimée après publication)
  media_url        text,
  clean_report     jsonb,          -- métadonnées retirées + empreintes avant/après
  lossless         boolean,
  ig_container_id  text,
  ig_media_id      text,
  permalink        text,
  published_at     timestamptz,
  error            text,
  attempts         integer NOT NULL DEFAULT 0,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_content_queue_due ON content_queue (status, scheduled_at);
