-- Sprint 18 — Colonne « région » sur les leads (déduite de la ville) pour filtrer
-- le cold call par région dans la liste et le pipeline.
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS region text;
COMMENT ON COLUMN public.leads.region IS 'Région administrative déduite de location (mapping src/lib/city-regions.json)';
