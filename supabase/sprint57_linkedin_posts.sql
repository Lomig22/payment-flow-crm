-- Sprint 57 : posts LinkedIn automatiques sur le profil de Lomig (API officielle « Share on LinkedIn »)
-- 2 à 3 posts par jour écrits par Claude : accroche, valeur, offre gratuite à demander en commentaire.

-- Connexion OAuth du profil (une seule ligne ; LinkedIn impose de se reconnecter tous les 60 jours)
create table if not exists linkedin_oauth (
  id            int primary key default 1 check (id = 1),
  access_token  text not null,
  member_urn    text not null,            -- urn:li:person:xxxx (auteur des posts)
  name          text,
  expires_at    timestamptz not null,
  reminded_at   timestamptz,              -- mail de rappel avant expiration
  connected_at  timestamptz not null default now()
);

-- Photos déposées par Lomig, réutilisées par les posts
create table if not exists linkedin_photos (
  id            uuid primary key default gen_random_uuid(),
  storage_path  text not null,            -- bucket content-media, linkedin/photos/…
  label         text,
  uses          int not null default 0,
  last_used_at  timestamptz,
  created_at    timestamptz not null default now()
);

create table if not exists linkedin_posts (
  id            uuid primary key default gen_random_uuid(),
  scheduled_at  timestamptz not null,
  topic         text,
  body          text not null,            -- texte publié tel quel (espaces « humains » compris)
  photo_id      uuid references linkedin_photos(id) on delete set null,
  status        text not null default 'scheduled' check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled')),
  attempts      int not null default 0,
  post_urn      text,
  error         text,
  feedback      text,                     -- retour de Lomig, transmis à Claude pour les suivants
  published_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists linkedin_posts_due on linkedin_posts (status, scheduled_at);
create unique index if not exists linkedin_posts_slot on linkedin_posts (scheduled_at) where status <> 'cancelled';

alter table linkedin_oauth  enable row level security;
alter table linkedin_photos enable row level security;
alter table linkedin_posts  enable row level security;
