-- Emailing (14/10/2026) : leads email importés dans le CRM, envoyés par l'agent Hermès
-- (Hermes Agent, depuis ses propres boîtes préchauffées). Le CRM décide qui contacter et quand
-- (séquence, arrêt à la réponse, désinscription, rebond), Hermès rédige, envoie et rapporte.
CREATE TABLE IF NOT EXISTS email_leads (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email         text NOT NULL,
  first_name    text,
  last_name     text,
  company       text,
  job_title     text,
  sector        text,
  city          text,
  phone         text,
  website       text,
  linkedin_url  text,
  custom        jsonb NOT NULL DEFAULT '{}'::jsonb,   -- autres colonnes du fichier
  source_file   text,
  status        text NOT NULL DEFAULT 'new' CHECK (status IN
                ('new', 'in_sequence', 'replied', 'interested', 'not_interested', 'bounced', 'unsubscribed', 'dnc', 'completed')),
  step          integer NOT NULL DEFAULT 0,          -- dernier mail envoyé (0 = aucun)
  claimed_at    timestamptz,                          -- remis à Hermès, envoi en attente
  last_sent_at  timestamptz,
  next_send_at  timestamptz,
  replied_at    timestamptz,
  mailbox       text,                                 -- boîte d'envoi (relances depuis la même)
  thread_id     text,
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS email_leads_email_key ON email_leads (lower(email));
CREATE INDEX IF NOT EXISTS email_leads_due_idx ON email_leads (status, next_send_at);
ALTER TABLE email_leads ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     uuid NOT NULL REFERENCES email_leads(id) ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN ('sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'interested', 'not_interested', 'note')),
  step        integer,
  subject     text,
  body        text,
  mailbox     text,
  message_id  text,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload     jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_events_lead_idx ON email_events (lead_id, occurred_at);
CREATE INDEX IF NOT EXISTS email_events_type_idx ON email_events (type, occurred_at);
CREATE UNIQUE INDEX IF NOT EXISTS email_events_dedup ON email_events (message_id, type) WHERE message_id IS NOT NULL;
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS email_settings (
  id           integer PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  active       boolean NOT NULL DEFAULT false,         -- interrupteur général des envois
  daily_goal   integer NOT NULL DEFAULT 1000,
  steps        jsonb NOT NULL DEFAULT '[
    {"step": 1, "delay_days": 0, "subject": "", "body": ""},
    {"step": 2, "delay_days": 3, "subject": "", "body": ""},
    {"step": 3, "delay_days": 7, "subject": "", "body": ""}
  ]'::jsonb,                                            -- séquence : délai depuis le mail précédent + modèle facultatif
  send_days    integer[] NOT NULL DEFAULT '{1,2,3,4,5}', -- lundi = 1
  send_from    integer NOT NULL DEFAULT 8,               -- heures de Paris
  send_to      integer NOT NULL DEFAULT 18,
  instructions text NOT NULL DEFAULT '',                 -- consignes de rédaction pour Hermès
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO email_settings (id) VALUES (1) ON CONFLICT (id) DO NOTHING;
