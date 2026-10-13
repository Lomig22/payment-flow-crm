import { NextRequest, NextResponse } from 'next/server';
import { hasCronKey } from '@/lib/cronAuth';
import { nextVoiceoverCandidate, runNextVoiceoverStep, voiceoverAuto, selectExtraVoiceovers } from '@/lib/voiceover';
import { autoScheduleDrafts } from '@/lib/autoSchedule';

// Voix off automatique (appelée toutes les 5 min par la crontab du VPS, /opt/pf-cron) : une étape
// d'un reel par appel — script, voix, montage, contrôle du rendu — pour tenir dans les 300 s.
export const dynamic     = 'force-dynamic';
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  if (!hasCronKey(request)) return NextResponse.json({ message: 'Non autorisé' }, { status: 401 });
  if (!voiceoverAuto()) return NextResponse.json({ skipped: 'Voix off automatique désactivée (VOICEOVER_AUTO)' });

  // VF en plus : 2 reels avec musique par jour, tant que le budget le permet
  const extra_marked = await selectExtraVoiceovers().catch(() => 0);
  const id = await nextVoiceoverCandidate();
  if (!id) return NextResponse.json({ idle: true, extra_marked });
  try {
    const { step, state } = await runNextVoiceoverStep(id);
    // Rendu vérifié : le reel peut prendre un créneau
    const auto_scheduled = step === 'verify' ? await autoScheduleDrafts() : 0;
    return NextResponse.json({ id, step, status: state.status, verify: state.verify ?? null, auto_scheduled });
  } catch (e: any) {
    return NextResponse.json({ id, message: e.message }, { status: 500 });
  }
}
