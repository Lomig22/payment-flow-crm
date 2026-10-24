-- Sprint 62 : posts LinkedIn validés par Lomig avant publication (25/10/2026 : « tu as programmé alors que je
-- voulais regarder les templates »). Un post ne part que s'il a été validé ; format provoc / valeur.
alter table linkedin_posts add column if not exists approved_at timestamptz;
alter table linkedin_posts add column if not exists kind text check (kind in ('provoc', 'valeur'));
