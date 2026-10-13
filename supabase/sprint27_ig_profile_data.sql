-- Sprint 27 — Données de profil Instagram pour personnaliser le script DM :
-- le message ne complimente les réalisations que si le compte a des publications visibles.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS posts_count integer;   -- null = inconnu
ALTER TABLE leads ADD COLUMN IF NOT EXISTS is_private  boolean;   -- null = inconnu
