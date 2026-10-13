-- Dédoublonnage des leads Instagram (2026-09-24), demandé par Lomig.
-- Clé = handle Instagram : instagram_username, sinon le premier @handle des
-- notes (anciens imports où le username n'était stocké que dans les notes).
-- Garde par groupe : statut le plus avancé du funnel DM, puis le plus
-- d'historique, puis un username renseigné, puis le plus ancien.

BEGIN;

CREATE TEMP TABLE ig_h AS
SELECT l.id, l.status, l.created_at,
       nullif(trim(both '@ ' from l.instagram_username), '') IS NOT NULL AS has_username,
       lower(coalesce(nullif(trim(both '@ ' from l.instagram_username), ''),
                      substring(l.notes from '@([A-Za-z0-9._]{2,30})'))) AS handle,
       (SELECT count(*) FROM lead_history h WHERE h.lead_id = l.id) AS hist
FROM leads l
WHERE l.source = 'instagram';

CREATE TEMP TABLE ig_ranked AS
SELECT id, handle,
       row_number() OVER (
         PARTITION BY handle
         ORDER BY CASE status
                    WHEN 'rdv' THEN 10 WHEN 'audit_envoye' THEN 9 WHEN 'audit_a_envoyer' THEN 8
                    WHEN 'a_relancer' THEN 7 WHEN 'reponse' THEN 6 WHEN 'r2' THEN 5
                    WHEN 'r1' THEN 4 WHEN 'm1' THEN 3 WHEN 'not_qualified' THEN 2 ELSE 1 END DESC,
                  hist DESC, has_username DESC, created_at ASC
       ) AS rn
FROM ig_h
WHERE handle IS NOT NULL;

CREATE TABLE dedup_bak_instagram_20260924 AS
SELECT * FROM leads WHERE id IN (SELECT id FROM ig_ranked WHERE rn > 1);

CREATE TABLE dedup_bak_instagram_history_20260924 AS
SELECT * FROM lead_history WHERE lead_id IN (SELECT id FROM dedup_bak_instagram_20260924);

CREATE TABLE dedup_bak_instagram_tags_20260924 AS
SELECT * FROM lead_tags WHERE lead_id IN (SELECT id FROM dedup_bak_instagram_20260924);

DELETE FROM leads WHERE id IN (SELECT id FROM dedup_bak_instagram_20260924);

-- Renseigne instagram_username depuis les notes quand il manque, pour que
-- le @ soit cliquable (lien DM) sur ces anciens leads aussi.
CREATE TABLE backfill_bak_ig_username_20260924 AS
SELECT l.id, l.instagram_username FROM leads l JOIN ig_h h ON h.id = l.id
WHERE l.source = 'instagram' AND NOT h.has_username AND h.handle IS NOT NULL;

UPDATE leads l SET instagram_username = h.handle
FROM ig_h h
WHERE h.id = l.id AND l.source = 'instagram' AND NOT h.has_username AND h.handle IS NOT NULL;

SELECT
  (SELECT count(*) FROM dedup_bak_instagram_20260924)          AS supprimes,
  (SELECT count(*) FROM dedup_bak_instagram_history_20260924)  AS bak_history,
  (SELECT count(*) FROM dedup_bak_instagram_tags_20260924)     AS bak_tags,
  (SELECT count(*) FROM backfill_bak_ig_username_20260924)     AS usernames_renseignes,
  (SELECT count(*) FROM leads WHERE source = 'instagram')      AS leads_instagram_restants,
  (SELECT count(*) FROM (SELECT lower(instagram_username) FROM leads
     WHERE source = 'instagram' AND instagram_username IS NOT NULL
     GROUP BY 1 HAVING count(*) > 1) d)                        AS doublons_restants;

COMMIT;
