-- Restauration du lot de 50 leads (import du 2026-08-14 15:12) depuis la
-- sauvegarde cleanup_bak_seaads_import_20260814, dans la sous-section SEA/ADS
-- cette fois (source='sea_ads'). Demandé par Lomig (option 1).

BEGIN;

INSERT INTO leads SELECT * FROM cleanup_bak_seaads_import_20260814;

UPDATE leads SET source = 'sea_ads'
WHERE id IN (SELECT id FROM cleanup_bak_seaads_import_20260814);

SELECT
  (SELECT count(*) FROM leads WHERE source = 'sea_ads')  AS total_sea_ads,
  (SELECT count(DISTINCT setter_id) FROM leads WHERE source = 'sea_ads') AS setters;

COMMIT;
