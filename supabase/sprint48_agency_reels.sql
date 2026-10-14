-- Fabrique de reels du compte agence @paymentflow (14/10/2026)
-- Chaque jour : 10 reels écrits par Claude (6 TOFU, 3 MOFU, 1 BOFU), rendus sur le VPS,
-- déposés dans la file de publication du compte agence puis programmés automatiquement.
CREATE TABLE IF NOT EXISTS agency_reels (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_username  text NOT NULL DEFAULT 'paymentflow',
  day               date NOT NULL,
  funnel            text NOT NULL CHECK (funnel IN ('tofu', 'mofu', 'bofu')),
  topic             text NOT NULL,
  spec              jsonb NOT NULL,               -- scènes (textes à l'écran + voix off)
  caption           text NOT NULL,
  voiced            boolean NOT NULL DEFAULT false,
  voice_credits     integer NOT NULL DEFAULT 0,   -- crédits ElevenLabs dépensés (hors cache)
  status            text NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'rendering', 'uploaded', 'failed')),
  attempts          integer NOT NULL DEFAULT 0,
  render_started_at timestamptz,
  queue_id          uuid,
  error             text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS agency_reels_status_idx ON agency_reels (status, created_at);
CREATE INDEX IF NOT EXISTS agency_reels_day_idx ON agency_reels (day);
ALTER TABLE agency_reels ENABLE ROW LEVEL SECURITY;

-- Programmation du compte agence : 10 créneaux par jour, sans remplissage
INSERT INTO publishing_settings (account_username, auto_schedule, reel_slots, filler_slots)
VALUES ('paymentflow', true, '{7,9,11,12,15,17,18,19,20,21}', '{}')
ON CONFLICT (account_username) DO UPDATE SET auto_schedule = true, reel_slots = EXCLUDED.reel_slots, filler_slots = EXCLUDED.filler_slots, updated_at = now();
