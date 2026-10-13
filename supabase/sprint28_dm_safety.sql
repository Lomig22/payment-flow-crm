-- Sprint 28 — Sécurité d'envoi Instagram : mise au repos des comptes, journal des
-- variantes de message (éviter d'envoyer deux fois de suite le même texte).
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS paused_until timestamptz;
ALTER TABLE social_accounts ADD COLUMN IF NOT EXISTS pause_reason text;
ALTER TABLE instagram_dm_log ADD COLUMN IF NOT EXISTS variant text;

-- Comptes restreints par Instagram (DM en « invitations masquées ») le 2026-09-28 :
-- trop de DM identiques à la minute. Repos 7 jours.
UPDATE social_accounts
SET paused_until = now() + interval '7 days',
    pause_reason = 'Restriction Instagram : DM en invitations masquées (trop d''envois identiques à la minute)'
WHERE platform = 'instagram' AND username IN ('lomig_guegueniat', 'lomig.guegueniat.ceo');
