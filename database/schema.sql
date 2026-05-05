-- ============================================================
-- Payment Flow CRM - Database Schema
-- PostgreSQL 15+
-- ============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- ENUM TYPES
-- ============================================================

CREATE TYPE user_role AS ENUM ('admin', 'setter');
CREATE TYPE lead_quality AS ENUM ('hot', 'warm', 'cold');
CREATE TYPE lead_status AS ENUM ('lost', 'in_progress', 'client');
CREATE TYPE action_type AS ENUM ('to_call', 'callback', 'follow_up', 'negotiation', 'no_action');

-- ============================================================
-- TABLE: users
-- ============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email         VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  first_name    VARCHAR(100) NOT NULL,
  last_name     VARCHAR(100) NOT NULL,
  role          user_role NOT NULL DEFAULT 'setter',
  is_active     BOOLEAN NOT NULL DEFAULT true,
  avatar_url    VARCHAR(500),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: import_batches (defined before leads for FK)
-- ============================================================

CREATE TABLE import_batches (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id            UUID REFERENCES users(id) ON DELETE SET NULL,
  filename           VARCHAR(255) NOT NULL,
  total_leads        INTEGER NOT NULL DEFAULT 0,
  assigned_setter_id UUID REFERENCES users(id) ON DELETE SET NULL,
  assignment_mode    VARCHAR(20) NOT NULL DEFAULT 'round_robin',
  created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: leads
-- ============================================================

CREATE TABLE leads (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  first_name          VARCHAR(100) NOT NULL,
  last_name           VARCHAR(100) NOT NULL,
  company             VARCHAR(255),
  phone               VARCHAR(50),
  email               VARCHAR(255),
  location            VARCHAR(255),
  -- Suivi commercial
  called              BOOLEAN NOT NULL DEFAULT false,
  action_in_progress  action_type NOT NULL DEFAULT 'to_call',
  lead_quality        lead_quality,
  need_identified     TEXT,
  setter_id           UUID REFERENCES users(id) ON DELETE SET NULL,
  -- Après appel
  appointment_taken   BOOLEAN NOT NULL DEFAULT false,
  appointment_honored BOOLEAN NOT NULL DEFAULT false,
  quote_sent          BOOLEAN NOT NULL DEFAULT false,
  r2_planned          BOOLEAN NOT NULL DEFAULT false,
  r3_planned          BOOLEAN NOT NULL DEFAULT false,
  -- Statut final
  status              lead_status NOT NULL DEFAULT 'in_progress',
  notes               TEXT,
  import_batch_id     UUID REFERENCES import_batches(id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: lead_history
-- ============================================================

CREATE TABLE lead_history (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lead_id       UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  user_id       UUID REFERENCES users(id) ON DELETE SET NULL,
  field_changed VARCHAR(100),
  old_value     TEXT,
  new_value     TEXT,
  action_note   TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: tags
-- ============================================================

CREATE TABLE tags (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       VARCHAR(50) UNIQUE NOT NULL,
  color      VARCHAR(7) NOT NULL DEFAULT '#6366f1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- TABLE: lead_tags (pivot)
-- ============================================================

CREATE TABLE lead_tags (
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id  UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_leads_setter_id   ON leads(setter_id);
CREATE INDEX idx_leads_status      ON leads(status);
CREATE INDEX idx_leads_quality     ON leads(lead_quality);
CREATE INDEX idx_leads_created_at  ON leads(created_at DESC);
CREATE INDEX idx_leads_called      ON leads(called);
CREATE INDEX idx_history_lead_id   ON lead_history(lead_id);
CREATE INDEX idx_history_created   ON lead_history(created_at DESC);
CREATE INDEX idx_users_email       ON users(email);
CREATE INDEX idx_users_role        ON users(role);

-- ============================================================
-- TRIGGERS: auto update updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON leads
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
