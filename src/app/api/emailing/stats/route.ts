import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden } from '@/lib/auth-server';
import { emailStats } from '@/lib/emailing';

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  return NextResponse.json(await emailStats());
}
