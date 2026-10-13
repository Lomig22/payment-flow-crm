import { NextRequest } from 'next/server';

// Appels machine (cron-job.org, script Google Drive) : clé CRON_SECRET en
// header « Authorization: Bearer … » ou en paramètre ?key=.
export function hasCronKey(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return request.headers.get('authorization') === `Bearer ${secret}`
    || request.nextUrl.searchParams.get('key') === secret;
}
