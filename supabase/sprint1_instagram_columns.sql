-- ============================================================
-- Sprint 1 — Colonnes Instagram + préparation funnel Sprint 2
-- À exécuter dans Supabase > SQL Editor
-- ============================================================

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS instagram_username  text,
  ADD COLUMN IF NOT EXISTS instagram_url       text,
  ADD COLUMN IF NOT EXISTS a_ouvert            boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS niche               text    DEFAULT '',
  ADD COLUMN IF NOT EXISTS bio                 text,
  ADD COLUMN IF NOT EXISTS followers_count     integer,
  ADD COLUMN IF NOT EXISTS ig_score            integer,
  -- Dates funnel Instagram (Sprint 2)
  ADD COLUMN IF NOT EXISTS m1_date             timestamptz,
  ADD COLUMN IF NOT EXISTS r1_date             timestamptz,
  ADD COLUMN IF NOT EXISTS r2_date             timestamptz,
  ADD COLUMN IF NOT EXISTS reponse_date        timestamptz,
  ADD COLUMN IF NOT EXISTS a_relancer_date     timestamptz,
  ADD COLUMN IF NOT EXISTS audit_date          timestamptz,
  ADD COLUMN IF NOT EXISTS rdv_date            timestamptz;

-- ── Migration des données existantes ──────────────────────────
-- Extrait @username depuis notes (format : "@handle | bio | Instagram : url | #hashtag")
UPDATE leads
SET instagram_username = substring(notes FROM '@([A-Za-z0-9._]+)')
WHERE source = 'instagram'
  AND notes IS NOT NULL
  AND notes LIKE '@%'
  AND instagram_username IS NULL;

-- Extrait l'URL Instagram depuis notes
UPDATE leads
SET instagram_url = (regexp_match(notes, 'Instagram : (https://www\.instagram\.com/[^\s|]+)'))[1]
WHERE source = 'instagram'
  AND notes IS NOT NULL
  AND notes LIKE '%Instagram : %'
  AND instagram_url IS NULL;

-- Extrait le score depuis notes si besoin (les leads importés via bot ont ig_score dans le champ score)
-- (pas besoin si les leads ont été créés avec ig_score via le webhook)
