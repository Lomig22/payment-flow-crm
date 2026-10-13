-- Sprint 38 — Limites d'envoi Instagram réglables par un admin (au lieu de valeurs
-- écrites dans le code), avec suspension temporaire. 0 = pas de limite.
CREATE TABLE IF NOT EXISTS instagram_limits (
  id               smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  dm_per_day       integer NOT NULL DEFAULT 40 CHECK (dm_per_day >= 0),
  follows_per_day  integer NOT NULL DEFAULT 80 CHECK (follows_per_day >= 0),
  dm_per_hour      integer NOT NULL DEFAULT 0  CHECK (dm_per_hour >= 0),
  dm_interval_sec  integer NOT NULL DEFAULT 0  CHECK (dm_interval_sec >= 0),
  suspended_until  timestamptz,               -- limites levées jusqu'à cette date
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
INSERT INTO instagram_limits (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
