import { NextResponse } from 'next/server';
import { publishDue } from '@/lib/instagramPublish';

// Déclencheur de secours de la publication (19/10/2026 : cron-job.org s'est arrêté après la panne du
// 18/10, plus aucun reel ne partait). Appelé toutes les 5 min par GitHub Actions
// (.github/workflows/publish-tick.yml), en plus de cron-job.org → /api/cron/instagram-sync.
// Sans clé : la route ne fait que publier ce qui est déjà programmé et dû (réclamation atomique dans
// publishDue, donc aucun doublon si les deux déclencheurs passent en même temps) ; elle ne renvoie
// que des compteurs.
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export async function GET() {
  try {
    const results = await publishDue(40_000);
    const count = (s: string) => results.filter((r) => r.status === s).length;
    return NextResponse.json({ published: count('published'), publishing: count('publishing'), failed: count('failed') + count('error') });
  } catch {
    return NextResponse.json({ error: 'échec' }, { status: 500 });
  }
}
