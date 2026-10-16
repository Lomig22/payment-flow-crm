-- Emailing en deux parcours (16/10/2026) : prospects AVEC site internet et SANS site, chacun avec son
-- premier mail et ses relances. Segment déduit de la colonne website (calculé, toujours à jour).
ALTER TABLE email_leads ADD COLUMN IF NOT EXISTS segment text
  GENERATED ALWAYS AS (CASE WHEN coalesce(trim(website), '') = '' THEN 'no_site' ELSE 'site' END) STORED;
CREATE INDEX IF NOT EXISTS email_leads_segment_idx ON email_leads (segment, status);
-- Séquences par segment : { "site": [étapes], "no_site": [étapes] } ; étape = { step, delay_days, subject, body }
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS sequences jsonb;
UPDATE email_settings SET sequences = jsonb_build_object('site', steps, 'no_site', steps) WHERE id = 1 AND sequences IS NULL;
