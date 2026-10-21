-- Sprint 60 : LinkedIn inbound (22/10/2026) — 2 posts par jour, chacun avec sa ressource gratuite écrite
-- par Claude (« Commente MOT et je t'envoie… »), publiée sur une page publique /r/<slug> dont Lomig
-- envoie le lien en message privé aux personnes qui commentent. Selfie choisi à la publication.
alter table linkedin_posts add column if not exists keyword        text;
alter table linkedin_posts add column if not exists resource_title text;
alter table linkedin_posts add column if not exists resource_body  text;   -- Markdown simple (titres, listes, gras)
alter table linkedin_posts add column if not exists resource_slug  text unique;
