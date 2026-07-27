-- Sprint 17 — Note Google (/5) et nombre d'avis GMB sur les leads.
-- Alimentées à l'import CSV (colonnes « rating » / « reviews ») et affichées
-- dans la liste cold call + les cartes du pipeline.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS rating  numeric(2,1);
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS reviews integer;

COMMENT ON COLUMN public.leads.rating  IS 'Note Google My Business sur 5 (ex. 4.9)';
COMMENT ON COLUMN public.leads.reviews IS 'Nombre d''avis Google My Business';
