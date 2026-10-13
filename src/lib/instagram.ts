// Nombre maximum de follows par jour et par compte Instagram (piste « follow d'abord »).
export const FOLLOW_DAILY_LIMIT = 80;

// Extrait le pseudo Instagram d'une valeur de CSV : « @pseudo », « pseudo », ou un
// lien de profil (« https://www.instagram.com/pseudo/?hl=fr », « instagram.com/pseudo »).
// Renvoie null si la valeur n'en contient pas (lien vers un post, autre site…).
export function parseIgUsername(raw?: string | null): string | null {
  const v = (raw ?? '').trim();
  if (!v) return null;
  if (/instagram\.com/i.test(v)) {
    const m = v.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:[?#]|$)/i);
    if (!m || ['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'direct'].includes(m[1].toLowerCase())) return null;
    return m[1].toLowerCase();
  }
  if (/^https?:\/\//i.test(v) || /\s/.test(v.replace(/^@/, ''))) return null;
  const u = v.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(u) ? u.toLowerCase() : null;
}

export const igProfileUrl =(username: string) =>
  `https://www.instagram.com/${encodeURIComponent(username.trim().replace(/^@/, ''))}/`;

// ── Sécurité d'envoi des DM (par compte d'envoi) ─────────────────────────────
// Ne concerne que les messages de prospection (M1, R1, R2) : ouvrir les DM pour
// répondre à une conversation en cours n'est jamais bloqué.
export const DM_DAILY_LIMIT       = 40;    // DM de prospection par jour
export const DM_HOURLY_LIMIT      = 0;     // … par heure glissante (0 = pas de limite ; retirée à la demande de Lomig le 05/10/2026)
export const DM_MIN_INTERVAL_SEC  = 0;     // délai minimum entre deux DM (retiré à la demande de Lomig le 05/10/2026)
// Un message ne reprend pas la formulation d'un des N derniers envoyés par le compte.
export const DM_VARIANT_MEMORY    = 8;

// Statuts depuis lesquels un clic sur le @ envoie un message de prospection.
export const DM_OUTREACH_STATUSES = ['lead', 'followed_back', 'm1', 'r1'];
