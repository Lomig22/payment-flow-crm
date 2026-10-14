-- Validation des reels de la fabrique par Lomig avant programmation (14/10/2026)
ALTER TABLE agency_reels ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'pending'
  CHECK (review_status IN ('pending', 'approved', 'rejected'));
ALTER TABLE agency_reels ADD COLUMN IF NOT EXISTS feedback text;
ALTER TABLE agency_reels ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
