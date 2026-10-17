-- Emailing (17/10/2026) : 3 recommandations sur le site de chaque prospect (variable {recommandations}),
-- calculées à l'avance par le CRM (constats relevés sur la page d'accueil + Claude).
ALTER TABLE email_leads ADD COLUMN IF NOT EXISTS site_reco    jsonb;        -- [{ reco, constat }], [] si site injoignable
ALTER TABLE email_leads ADD COLUMN IF NOT EXISTS site_reco_at timestamptz;
