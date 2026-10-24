-- Sprint 61 : boîte d'envoi de chaque mail Hermès (24/10/2026 : Hermès alterne lomig.guegueniat@gmail.com et
-- paymentfloww@gmail.com ; une réponse arrive dans la boîte qui a envoyé le mail, le lien Gmail doit l'ouvrir).
alter table email_campaign_messages add column if not exists mailbox text;
