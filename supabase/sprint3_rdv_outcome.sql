-- Sprint 3: RDV outcome tracking
-- Run in Supabase SQL Editor after sprint1_instagram_columns.sql

ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS rdv_outcome TEXT
    CHECK (rdv_outcome IN ('present', 'vendu', 'no_show', 'pas_qualifie'));

COMMENT ON COLUMN leads.rdv_outcome IS 'Résultat du RDV: present | vendu | no_show | pas_qualifie';
