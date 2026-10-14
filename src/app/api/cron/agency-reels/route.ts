import { NextRequest, NextResponse } from 'next/server';
import { hasCronKey } from '@/lib/cronAuth';
import { planDay, nextJob, uploadUrl, markDone, markFailed, AGENCY_ACCOUNT } from '@/lib/agencyReels';
import { autoScheduleDrafts } from '@/lib/autoSchedule';

// Fabrique de reels @paymentflow (sprint48), appelée par le VPS. Protégé par CRON_SECRET.
//   GET  ?action=plan[&day=AAAA-MM-JJ]  écrit les reels du jour (Claude)
//   GET  ?action=next                   prochain reel à rendre (textes + liens des voix)
//   POST {action:'upload', id, size}    entrée dans la file + URL signée de dépôt
//   POST {action:'done', id}            vidéo déposée
//   POST {action:'fail', id, error}     échec du rendu (nouvel essai, 3 au plus)
export const dynamic     = 'force-dynamic';
export const maxDuration = 300;

const deny = () => NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
const fail = (e: any) => NextResponse.json({ message: e?.message ?? String(e) }, { status: 500 });

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return deny();
  const action = request.nextUrl.searchParams.get('action');
  try {
    if (action === 'plan') return NextResponse.json(await planDay(request.nextUrl.searchParams.get('day') ?? undefined));
    if (action === 'next') {
      // Au passage : les reels déjà traités par la file reçoivent leur créneau
      const scheduled = await autoScheduleDrafts(AGENCY_ACCOUNT).catch(() => 0);
      return NextResponse.json({ job: await nextJob(), scheduled });
    }
    return NextResponse.json({ message: 'Action inconnue' }, { status: 400 });
  } catch (e) { return fail(e); }
}

export async function POST(request: NextRequest) {
  if (!hasCronKey(request)) return deny();
  const { action, id, size, error } = await request.json().catch(() => ({}));
  if (!id) return NextResponse.json({ message: 'id manquant' }, { status: 400 });
  try {
    if (action === 'upload') return NextResponse.json(await uploadUrl(id, Number(size) || 0));
    if (action === 'done') { await markDone(id); return NextResponse.json({ ok: true }); }
    if (action === 'fail') { await markFailed(id, String(error ?? 'Erreur inconnue')); return NextResponse.json({ ok: true }); }
    return NextResponse.json({ message: 'Action inconnue' }, { status: 400 });
  } catch (e) { return fail(e); }
}
