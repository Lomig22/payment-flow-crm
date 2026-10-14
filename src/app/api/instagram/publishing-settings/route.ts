import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { getPublishingSettings, autoScheduleDrafts } from '@/lib/autoSchedule';

// Réglages de la programmation automatique (page Publication)
export const dynamic = 'force-dynamic';

// Compte demandé (?account=), sinon le premier connecté
async function account(request: NextRequest): Promise<string> {
  const wanted = request.nextUrl.searchParams.get('account');
  const { data } = await (supabase as any).from('instagram_tokens').select('account_username').order('account_username');
  const list = (data ?? []).map((t: any) => t.account_username);
  return wanted && list.includes(wanted) ? wanted : list[0] ?? 'lomig_guegueniat';
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();
  return NextResponse.json(await getPublishingSettings(await account(request)));
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const b = await request.json();
  // Grille de créneaux : heures pleines (0-23), sans doublon ; une heure est soit
  // prioritaire, soit de remplissage
  const hours = (v: unknown) => Array.isArray(v) ? Array.from(new Set(v.map(Number))) : null;
  const reel = hours(b.reel_slots), filler = hours(b.filler_slots);
  if (!reel || !filler || [...reel, ...filler].some((h) => !Number.isInteger(h) || h < 0 || h > 23)) {
    return badRequest('Créneaux invalides (heures de 0 à 23)');
  }
  if (!reel.length) return badRequest('Au moins un créneau prioritaire');

  const username = await account(request);
  const { data, error } = await (supabase as any).from('publishing_settings').upsert({
    account_username: username,
    auto_schedule:    !!b.auto_schedule,
    reel_slots:       reel.sort((x, y) => x - y),
    filler_slots:     filler.filter((h) => !reel.includes(h)),
    updated_at:       new Date().toISOString(),
  }).select('auto_schedule, reel_slots, filler_slots').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  // Activation : on programme tout de suite ce qui est prêt
  const scheduled = data.auto_schedule ? await autoScheduleDrafts(username) : 0;
  return NextResponse.json({ ...data, scheduled });
}
