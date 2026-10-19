-- Sprint 58 : suivi des campagnes envoyées directement par Hermès (hors séquences du CRM).
-- 19/10/2026 : 1re campagne « maquette » (273 mails via l'API Gmail de lomig.guegueniat@gmail.com).
-- Un script du VPS lit le journal d'envoi d'Hermès et la boîte Gmail (réponses, rebonds) et remonte
-- tout ici ; Lomig classe chaque réponse positive ou négative.

create table if not exists email_campaigns (
  id             text primary key,          -- ex. hermes-emails_a_envoyer-maquette-2026-10-19
  name           text not null,
  source         text,                      -- fichier d'Hermès
  first_sent_at  timestamptz,
  open_tracking  boolean not null default false,   -- pixel de suivi présent dans les mails
  created_at     timestamptz not null default now()
);

create table if not exists email_campaign_messages (
  id             uuid primary key default gen_random_uuid(),
  campaign_id    text not null references email_campaigns(id) on delete cascade,
  gmail_id       text not null unique,
  thread_id      text,
  email          text not null,
  company        text,
  subject        text,
  sent_at        timestamptz,
  opened_at      timestamptz,
  open_count     int not null default 0,
  replied_at     timestamptz,
  reply_snippet  text,
  bounced_at     timestamptz,
  sentiment      text check (sentiment in ('positive', 'negative')),
  sentiment_at   timestamptz,
  updated_at     timestamptz not null default now()
);
create index if not exists email_campaign_messages_campaign on email_campaign_messages (campaign_id);

alter table email_campaigns enable row level security;
alter table email_campaign_messages enable row level security;
