-- Sprint 25 — Vérification quotidienne des follow backs par le VA.
-- « Follow back ? Non » horodate la vérification (la carte affiche « vérifié le … »)
-- sans changer le statut ; « Oui » passe le lead en followed_back (followed_back_at).
ALTER TABLE leads ADD COLUMN IF NOT EXISTS follow_back_checked_at timestamptz;
