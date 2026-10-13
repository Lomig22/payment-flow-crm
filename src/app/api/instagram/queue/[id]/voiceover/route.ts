import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { hasCronKey } from '@/lib/cronAuth';
import {
  prepareVoiceoverScript, saveVoiceoverScript, generateVoice, renderQueueVoiceover, verifyVoiceover,
  runNextVoiceoverStep, VoiceoverError, voiceoverEnabled, voiceoverAuto,
} from '@/lib/voiceover';

// Voix off d'un reel (voir src/lib/voiceover.ts), une étape par appel :
//   { action: 'script', force? }   hook + corps (rotation de la banque)
//   { action: 'save', segments }   script retouché (le hook reste celui de la banque)
//   { action: 'voice' }            voix ElevenLabs phrase par phrase, contrôlée
//   { action: 'render' }           montage + fin CTA ; remplace la vidéo publiée
//   { action: 'verify' }           transcription du rendu (aucune autre voix que celle de Lomig)
//   { action: 'step' }             étape suivante, quelle qu'elle soit
export const dynamic     = 'force-dynamic';
export const maxDuration = 300;

export async function POST(request: NextRequest, { params }: { params: { id: string } }) {
  if (!hasCronKey(request)) {
    const user = await getAuthUser(request);
    if (!user) return unauthorized();
    if (user.role !== 'admin') return forbidden();
  }
  const body = await request.json().catch(() => ({}));
  try {
    switch (body.action) {
      case 'script': return NextResponse.json(await prepareVoiceoverScript(params.id, !!body.force));
      case 'save':
        if (!Array.isArray(body.segments)) return badRequest('segments requis');
        return NextResponse.json(await saveVoiceoverScript(params.id, body.segments));
      case 'voice':  return NextResponse.json(await generateVoice(params.id));
      case 'render': return NextResponse.json(await renderQueueVoiceover(params.id));
      case 'verify': return NextResponse.json(await verifyVoiceover(params.id));
      case 'step':   return NextResponse.json(await runNextVoiceoverStep(params.id));
      default:       return badRequest('action invalide');
    }
  } catch (e: any) {
    return NextResponse.json({ message: e.message }, { status: e instanceof VoiceoverError ? e.status : 500 });
  }
}

export async function GET() {
  return NextResponse.json({ enabled: voiceoverEnabled(), auto: voiceoverAuto() });
}
