-- Sprint 40 — Début de la plage de publication à la demi-heure près (ex. 7 h 30).
ALTER TABLE publishing_settings ADD COLUMN IF NOT EXISTS start_minute integer NOT NULL DEFAULT 0
  CHECK (start_minute BETWEEN 0 AND 59);
