-- Sprint 63 : modèle des posts LinkedIn réglé par Lomig dans le CRM (25/10/2026) : le CTA est toujours le
-- même mot, ajouté par le CRM à la fin de chaque post (plus écrit par Claude). {mot} et {ressource} remplacés.
create table if not exists linkedin_post_settings (
  id            int primary key default 1 check (id = 1),
  cta_keyword   text not null default 'GO',
  cta_template  text not null default 'Commente {mot} et je t''envoie {ressource} gratuitement.',
  updated_at    timestamptz not null default now()
);
insert into linkedin_post_settings (id) values (1) on conflict (id) do nothing;
alter table linkedin_post_settings enable row level security;
