-- ─── Migration Bot Instagram ─────────────────────────────────────────────────
-- À coller et exécuter dans Supabase → SQL Editor

-- 1. Colonnes Instagram dans la table leads
ALTER TABLE leads
  ADD COLUMN IF NOT EXISTS instagram_username text,
  ADD COLUMN IF NOT EXISTS instagram_score    int DEFAULT 0;

-- Index unique partiel : uniquement quand instagram_username est renseigné
CREATE UNIQUE INDEX IF NOT EXISTS leads_instagram_username_unique
  ON leads (instagram_username)
  WHERE instagram_username IS NOT NULL;

-- 2. Table de suivi des runs du bot
CREATE TABLE IF NOT EXISTS bot_runs (
  id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  started_at     timestamptz DEFAULT now(),
  finished_at    timestamptz,
  status         text DEFAULT 'running' CHECK (status IN ('running', 'completed', 'error')),
  runs_total     int DEFAULT 0,
  runs_done      int DEFAULT 0,
  leads_inserted int DEFAULT 0,
  leads_updated  int DEFAULT 0,
  error_message  text
);

-- 3. Fonction d'incrémentation atomique (évite les race conditions webhook)
CREATE OR REPLACE FUNCTION increment_bot_run(
  p_id       uuid,
  p_inserted int DEFAULT 0,
  p_updated  int DEFAULT 0
) RETURNS void AS $$
BEGIN
  UPDATE bot_runs SET
    runs_done      = runs_done + 1,
    leads_inserted = leads_inserted + p_inserted,
    leads_updated  = leads_updated  + p_updated,
    status         = CASE WHEN runs_done + 1 >= runs_total THEN 'completed' ELSE 'running' END,
    finished_at    = CASE WHEN runs_done + 1 >= runs_total THEN NOW()       ELSE NULL      END
  WHERE id = p_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 4. Fonction d'upsert des leads Instagram
CREATE OR REPLACE FUNCTION upsert_instagram_leads(p_leads jsonb)
RETURNS jsonb AS $$
DECLARE
  lead         jsonb;
  inserted     int := 0;
  updated      int := 0;
  was_inserted bool;
BEGIN
  FOR lead IN SELECT * FROM jsonb_array_elements(p_leads) LOOP
    INSERT INTO leads (
      first_name, last_name, email, source, notes,
      instagram_username, instagram_score,
      called, action_in_progress, status,
      appointment_taken, appointment_honored, quote_sent, r2_planned, r3_planned
    ) VALUES (
      lead->>'first_name',
      lead->>'last_name',
      NULLIF(lead->>'email', ''),
      'instagram',
      lead->>'notes',
      lead->>'instagram_username',
      (lead->>'instagram_score')::int,
      false, 'to_call', 'in_progress',
      false, false, false, false, false
    )
    ON CONFLICT (instagram_username) WHERE instagram_username IS NOT NULL
    DO UPDATE SET
      instagram_score = GREATEST(EXCLUDED.instagram_score, leads.instagram_score),
      notes           = CASE
                          WHEN EXCLUDED.instagram_score >= leads.instagram_score
                          THEN EXCLUDED.notes
                          ELSE leads.notes
                        END,
      email           = COALESCE(EXCLUDED.email, leads.email),
      updated_at      = NOW()
    RETURNING (xmax = 0) INTO was_inserted;

    IF was_inserted THEN inserted := inserted + 1;
    ELSE updated := updated + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('inserted', inserted, 'updated', updated);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
