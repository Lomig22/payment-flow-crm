-- Sprint 33 — Détection des vidéos déjà publiées.
-- Empreinte visuelle (dHash 64 bits, hex) de la miniature de chaque contenu publié,
-- calculée par la synchro ; à l'import, les images de la vidéo sont comparées à ces
-- empreintes (Instagram réencode les vidéos : une empreinte de fichier ne marcherait pas).
ALTER TABLE ig_content ADD COLUMN IF NOT EXISTS thumb_hash text;
