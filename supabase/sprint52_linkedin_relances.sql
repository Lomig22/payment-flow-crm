-- Relances LinkedIn configurables (15/10/2026) : 1 à 16 relances (R1 … R16), chacune avec son délai
-- (jours ouvrés après le message précédent) et son texte selon la question (Q1 / Q2).
-- Vide = R1 / R2 / R3 d'origine. Réglées dans l'onglet LinkedIn > Messages.
ALTER TABLE linkedin_settings ADD COLUMN IF NOT EXISTS relances jsonb NOT NULL DEFAULT '[]'::jsonb;
