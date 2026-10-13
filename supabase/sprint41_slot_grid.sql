-- Sprint 41 — Grille de créneaux de publication des reels (heures pleines, heure de Paris),
-- validée par Lomig le 07/10/2026 : 1 h avant les pics d'usage des artisans.
--   reel_slots   : créneaux prioritaires (remplis en premier)
--   filler_slots : créneaux de remplissage, dans l'ordre, quand la journée en demande plus
ALTER TABLE publishing_settings ADD COLUMN IF NOT EXISTS reel_slots   integer[] NOT NULL DEFAULT '{7,9,11,12,15,17,18,19,20,21}';
ALTER TABLE publishing_settings ADD COLUMN IF NOT EXISTS filler_slots integer[] NOT NULL DEFAULT '{13,22,8,10,14,16}';
