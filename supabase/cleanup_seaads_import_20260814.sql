-- Retrait du lot de 50 leads importés par erreur en cold_call le 2026-08-14 à 15:12
-- (import destiné à la sous-section SEA/ADS). Demandé par Lomig.
-- Sauvegardes avant DELETE, pattern habituel cleanup_bak_*.

BEGIN;

CREATE TABLE cleanup_bak_seaads_import_20260814 AS
SELECT * FROM leads
WHERE created_at > now() - interval '2 hours' AND source = 'cold_call';

CREATE TABLE cleanup_bak_seaads_import_history_20260814 AS
SELECT * FROM lead_history
WHERE lead_id IN (SELECT id FROM cleanup_bak_seaads_import_20260814);

CREATE TABLE cleanup_bak_seaads_import_tags_20260814 AS
SELECT * FROM lead_tags
WHERE lead_id IN (SELECT id FROM cleanup_bak_seaads_import_20260814);

DELETE FROM leads
WHERE id IN (SELECT id FROM cleanup_bak_seaads_import_20260814);

SELECT
  (SELECT count(*) FROM cleanup_bak_seaads_import_20260814)         AS bak_leads,
  (SELECT count(*) FROM cleanup_bak_seaads_import_history_20260814) AS bak_history,
  (SELECT count(*) FROM cleanup_bak_seaads_import_tags_20260814)    AS bak_tags,
  (SELECT count(*) FROM leads WHERE created_at > now() - interval '2 hours' AND source='cold_call') AS restants;

COMMIT;
