import { createHmac, timingSafeEqual } from 'crypto';

// Suivi des mails envoyés par Hermès : pixel d'ouverture et lien de désinscription propres au CRM.
// Jeton = lead + numéro du mail, signé (personne ne peut fabriquer une ouverture ou une
// désinscription pour un autre lead).

const BASE = process.env.APP_URL || 'https://payment-flow-crm-delta.vercel.app';
const sign = (payload: string) => createHmac('sha256', process.env.EMAILING_AGENT_KEY ?? 'pf').update(payload).digest('base64url').slice(0, 22);

export function trackingToken(leadId: string, step: number): string {
  const payload = `${leadId}.${step}`;
  return `${payload}.${sign(payload)}`;
}

export function readToken(token: string): { leadId: string; step: number } | null {
  const m = /^([0-9a-f-]{36})\.(\d{1,2})\.([\w-]{22})$/.exec(token);
  if (!m) return null;
  const want = Buffer.from(sign(`${m[1]}.${m[2]}`)), got = Buffer.from(m[3]);
  return want.length === got.length && timingSafeEqual(want, got) ? { leadId: m[1], step: Number(m[2]) } : null;
}

export function trackingFor(leadId: string, step: number) {
  const t = trackingToken(leadId, step);
  const pixel_url = `${BASE}/api/emailing/o/${t}`;
  const unsubscribe_url = `${BASE}/api/emailing/u/${t}`;
  return {
    pixel_url, unsubscribe_url,
    pixel_html: `<img src="${pixel_url}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px" />`,
  };
}
