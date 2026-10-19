-- Sprint 59 : type de chaque réponse aux campagnes Hermès (19/10/2026) : vraie réponse, réponse
-- automatique (absence, changement d'adresse) ou anti-spam (MailInBlack, Xefi… : le mail est bloqué
-- tant qu'on ne clique pas sur le lien de validation). Seules les vraies réponses comptent dans le taux.
alter table email_campaign_messages add column if not exists reply_kind text check (reply_kind in ('human', 'auto', 'antispam'));
alter table email_campaign_messages add column if not exists reply_gmail_id text;   -- lien direct vers la réponse dans Gmail
update email_campaign_messages set reply_kind = 'human' where replied_at is not null and reply_kind is null;
