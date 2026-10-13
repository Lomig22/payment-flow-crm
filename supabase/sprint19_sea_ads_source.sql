-- Sprint 19 — Sous-section SEA/ADS du pôle Cold Call
-- Nouvelle valeur de source 'sea_ads' : mêmes statuts/pipeline que cold_call,
-- mais liste, pipeline et import CSV dédiés.

ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_source_check;
ALTER TABLE leads ADD CONSTRAINT leads_source_check
  CHECK (source = ANY (ARRAY['instagram'::text, 'facebook'::text, 'cold_call'::text, 'sea_ads'::text]));
