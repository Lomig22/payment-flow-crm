-- Sprint 34 — Programmation automatique de la file de publication.
-- Une vidéo prête (reel avec légende, ou story) reçoit seule le prochain créneau
-- libre : un reel toutes les `interval_min` minutes entre start_hour et end_hour
-- (heure de Paris), dans la limite de l'objectif journalier (content_targets).
-- Les reels postés à la main (relevés par la synchro) occupent leur créneau.
CREATE TABLE IF NOT EXISTS publishing_settings (
  account_username text PRIMARY KEY,
  auto_schedule    boolean NOT NULL DEFAULT false,
  start_hour       integer NOT NULL DEFAULT 9  CHECK (start_hour BETWEEN 0 AND 23),
  end_hour         integer NOT NULL DEFAULT 21 CHECK (end_hour BETWEEN 1 AND 24),
  interval_min     integer NOT NULL DEFAULT 60 CHECK (interval_min BETWEEN 15 AND 240),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO publishing_settings (account_username) VALUES ('lomig_guegueniat')
ON CONFLICT (account_username) DO NOTHING;
