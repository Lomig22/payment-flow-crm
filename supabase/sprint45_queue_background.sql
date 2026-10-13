-- Sprint 45 — Traitement des vidéos importées en arrière-plan (13/10/2026)
-- Le navigateur envoie seulement le fichier brut puis marque l'entrée « envoyée » (uploaded_at).
-- Le cron du VPS traite ensuite les entrées une par une (nettoyage, fin CTA, analyse audio,
-- empreintes, légende), sans limite de 5 min côté navigateur et avec nouvel essai automatique.
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS uploaded_at      timestamptz;   -- fichier brut complet dans Storage
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS processing_at    timestamptz;   -- verrou : traitement en cours depuis
ALTER TABLE content_queue ADD COLUMN IF NOT EXISTS process_attempts integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS content_queue_uploaded_idx ON content_queue (uploaded_at) WHERE status = 'uploading';

-- Envois du 12-13/10 restés bloqués après un 504 : le fichier brut est peut-être complet, on retente
UPDATE content_queue SET uploaded_at = updated_at WHERE status = 'uploading' AND uploaded_at IS NULL;
