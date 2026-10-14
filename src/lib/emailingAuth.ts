import { NextRequest } from 'next/server';
import { timingSafeEqual } from 'crypto';

// Accès de l'agent Hermès à l'API Emailing : clé dédiée EMAILING_AGENT_KEY en header
// « Authorization: Bearer … » (jamais en paramètre d'URL : elle finirait dans les journaux)
export function hasAgentKey(request: NextRequest): boolean {
  const key = process.env.EMAILING_AGENT_KEY;
  const got = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!key || got.length !== key.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(key));
}
