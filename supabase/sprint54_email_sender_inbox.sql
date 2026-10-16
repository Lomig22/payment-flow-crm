-- Emailing (16/10/2026) : boîte d'envoi de Lomig, signature ajoutée à chaque mail, lecture des réponses
-- par le CRM (IMAP Gmail, lecture seule ; mot de passe d'application dans GMAIL_APP_PASSWORD).
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS sender_email   text NOT NULL DEFAULT 'lomig.guegueniat@gmail.com';
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS sender_name    text NOT NULL DEFAULT 'Lomig Guégueniat';
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS signature      text NOT NULL DEFAULT '';
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_last_uid  bigint NOT NULL DEFAULT 0;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_checked_at timestamptz;
ALTER TABLE email_settings ADD COLUMN IF NOT EXISTS imap_error     text;
