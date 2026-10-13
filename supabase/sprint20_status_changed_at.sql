-- Sprint 20 — Tri des colonnes pipeline : dernier arrivé en haut.
-- `status_changed_at` = date du dernier changement de statut (= entrée dans la
-- colonne). Maintenu par trigger pour couvrir tous les chemins (drag pipeline,
-- bulk-status, formulaire, SQL manuel). Backfill via updated_at (meilleure
-- approximation disponible pour l'existant).

-- leads : ajout SANS default d'abord (sinon toutes les lignes existantes
-- recevraient now() et perdraient leur ordre), backfill, puis default.
ALTER TABLE leads ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
UPDATE leads SET status_changed_at = COALESCE(updated_at, created_at) WHERE status_changed_at IS NULL;
ALTER TABLE leads ALTER COLUMN status_changed_at SET DEFAULT now();

-- qualiopi_leads : même pipeline (variant qualiopi de PipelineBoard).
ALTER TABLE qualiopi_leads ADD COLUMN IF NOT EXISTS status_changed_at timestamptz;
UPDATE qualiopi_leads SET status_changed_at = COALESCE(updated_at, created_at) WHERE status_changed_at IS NULL;
ALTER TABLE qualiopi_leads ALTER COLUMN status_changed_at SET DEFAULT now();

CREATE OR REPLACE FUNCTION update_status_changed_at()
RETURNS trigger AS $$
BEGIN
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    NEW.status_changed_at = now();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS leads_status_changed_at ON leads;
CREATE TRIGGER leads_status_changed_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_status_changed_at();

DROP TRIGGER IF EXISTS qualiopi_leads_status_changed_at ON qualiopi_leads;
CREATE TRIGGER qualiopi_leads_status_changed_at
  BEFORE UPDATE ON qualiopi_leads
  FOR EACH ROW EXECUTE FUNCTION update_status_changed_at();
