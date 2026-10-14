import { voiceoverBlocks } from '@/lib/voiceover';
import { supabase } from '@/lib/supabase';

// Programmation automatique de la file : chaque contenu prêt (reel avec légende,
// story) reçoit le prochain créneau libre (heure de Paris).
//   Reels : grille de créneaux à heure pile, placés 1 h avant les pics d'usage des
//   artisans. Chaque jour, les créneaux prioritaires (dans l'ordre chronologique), puis
//   les créneaux de remplissage (dans l'ordre choisi) quand la journée en demande plus.
//   Stories : 10 h, 14 h, 19 h, dans la limite de l'objectif du jour.
// Les contenus déjà publiés (à la main ou par l'API) occupent leur créneau.

const STORY_SLOTS = [10 * 60, 14 * 60, 19 * 60];   // minutes après minuit
const MIN = 60_000;
const DAY = 86_400_000;

export interface PublishingSettings {
  auto_schedule: boolean;
  reel_slots:    number[];   // heures prioritaires
  filler_slots:  number[];   // heures de remplissage, dans l'ordre
}

export const DEFAULT_SETTINGS: PublishingSettings = {
  auto_schedule: false,
  reel_slots:    [7, 9, 11, 12, 15, 17, 18, 19, 20, 21],
  filler_slots:  [13, 22, 8, 10, 14, 16],
};

export async function getPublishingSettings(account: string): Promise<PublishingSettings> {
  const { data } = await (supabase as any).from('publishing_settings')
    .select('auto_schedule, reel_slots, filler_slots').eq('account_username', account).maybeSingle();
  return data ? { ...DEFAULT_SETTINGS, ...data } : DEFAULT_SETTINGS;
}

// Minuit (heure de Paris) du jour contenant `at`, en instant UTC
export function parisMidnight(at: Date): Date {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(at).map((x) => [x.type, x.value]),
  );
  const offset = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - at.getTime();
  return new Date(Date.UTC(+p.year, +p.month - 1, +p.day) - offset);
}

const parisDay = (t: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date(t));

// Créneaux candidats des 30 prochains jours, dans l'ordre où ils doivent être remplis
function candidates(format: 'reel' | 'story', s: PublishingSettings): number[] {
  const order = format === 'story'
    ? STORY_SLOTS
    : [...[...s.reel_slots].sort((a, b) => a - b), ...s.filler_slots.filter((h) => !s.reel_slots.includes(h))].map((h) => h * 60);
  const out: number[] = [];
  for (let d = 0; d < 30; d++) {
    const midnight = parisMidnight(new Date(Date.now() + d * DAY)).getTime();
    for (const m of order) out.push(midnight + m * MIN);
  }
  return out;
}

// `force` : programmation demandée à la main (« Valider et programmer »), même pilote désactivé
export async function autoScheduleDrafts(account?: string, force = false): Promise<number> {
  const db = supabase as any;
  // Sans compte précisé : chaque compte connecté, sur ses propres créneaux
  if (!account) {
    const { data: tokens } = await db.from('instagram_tokens').select('account_username');
    let n = 0;
    for (const t of tokens ?? []) n += await autoScheduleDrafts(t.account_username, force);
    return n;
  }
  const username = account;
  const settings = await getPublishingSettings(username);
  if (!settings.auto_schedule && !force) return 0;

  const { data: drafts } = await db.from('content_queue')
    .select('id, format, caption, clean_report')
    .eq('account_username', username)
    .eq('status', 'draft')
    .order('created_at', { ascending: true });
  // Reels de la fabrique (compte agence) : seulement ceux que Lomig a validés
  const { data: held } = await db.from('agency_reels').select('queue_id').neq('review_status', 'approved').not('queue_id', 'is', null);
  const heldIds = new Set((held ?? []).map((h: any) => h.queue_id));
  // Reels : légende écrite, et voix off française montée si nécessaire (voir voiceover.ts)
  const ready = (drafts ?? []).filter((d: any) => !heldIds.has(d.id) && (d.format === 'story'
    || (d.caption && d.caption.trim() && !voiceoverBlocks(d.clean_report))));
  if (!ready.length) return 0;

  const since = parisMidnight(new Date()).toISOString();
  const [{ data: queued }, { data: targets }, { data: published }] = await Promise.all([
    db.from('content_queue').select('format, scheduled_at').eq('account_username', username)
      .in('status', ['scheduled', 'publishing']).not('scheduled_at', 'is', null),
    db.from('content_targets').select('format, per_day').eq('account_username', username),
    db.from('ig_content').select('format, published_at').eq('account_username', username).gte('published_at', since),
  ]);

  // Créneaux occupés par format (reel = reels/posts/carrousels) ; compteur du jour pour les stories
  const kind = (f: string) => (f === 'story' ? 'story' : 'reel');
  const taken: Record<'reel' | 'story', number[]> = { reel: [], story: [] };
  const storiesPerDay = new Map<string, number>();
  const occupy = (f: 'reel' | 'story', t: number) => {
    taken[f].push(t);
    if (f === 'story') storiesPerDay.set(parisDay(t), (storiesPerDay.get(parisDay(t)) ?? 0) + 1);
  };
  for (const q of queued ?? []) occupy(kind(q.format), new Date(q.scheduled_at).getTime());
  for (const p of published ?? []) occupy(kind(p.format), new Date(p.published_at).getTime());

  const storyTarget = (targets ?? []).find((t: any) => t.format === 'story')?.per_day ?? 3;
  const GAP = 30 * MIN;   // un créneau est pris si un contenu est publié/prévu à ± 30 min
  const earliest = Date.now() + 10 * MIN;

  let scheduled = 0;
  for (const d of ready) {
    const f = kind(d.format);
    const slot = candidates(f, settings).find((t) =>
      t >= earliest
      && (f === 'reel' || (storiesPerDay.get(parisDay(t)) ?? 0) < storyTarget)
      && !taken[f].some((x) => Math.abs(x - t) < GAP));
    if (!slot) break;
    const { data: ok } = await db.from('content_queue')
      .update({ status: 'scheduled', scheduled_at: new Date(slot).toISOString(), updated_at: new Date().toISOString() })
      .eq('id', d.id).eq('status', 'draft').select('id');
    if (ok?.length) { occupy(f, slot); scheduled++; }
  }
  return scheduled;
}
