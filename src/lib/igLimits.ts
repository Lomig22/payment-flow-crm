import { supabase } from '@/lib/supabase';
import { DM_DAILY_LIMIT, FOLLOW_DAILY_LIMIT, DM_HOURLY_LIMIT, DM_MIN_INTERVAL_SEC } from '@/lib/instagram';

// Limites d'envoi Instagram (par compte), réglables par un admin. 0 = pas de limite.
// Pendant une suspension (suspended_until dans le futur), aucune limite ne s'applique.
export interface IgLimits {
  dm_per_day: number; follows_per_day: number; dm_per_hour: number; dm_interval_sec: number;
  suspended_until: string | null; suspended: boolean;
}

const DEFAULTS = { dm_per_day: DM_DAILY_LIMIT, follows_per_day: FOLLOW_DAILY_LIMIT, dm_per_hour: DM_HOURLY_LIMIT, dm_interval_sec: DM_MIN_INTERVAL_SEC };

// Réglages enregistrés (tels que saisis)
export async function getStoredLimits(): Promise<IgLimits> {
  const { data } = await (supabase as any).from('instagram_limits').select('*').eq('id', 1).maybeSingle();
  const r = { ...DEFAULTS, ...(data ?? {}) };
  const suspended = !!r.suspended_until && new Date(r.suspended_until).getTime() > Date.now();
  return {
    dm_per_day: r.dm_per_day, follows_per_day: r.follows_per_day, dm_per_hour: r.dm_per_hour,
    dm_interval_sec: r.dm_interval_sec, suspended_until: suspended ? r.suspended_until : null, suspended,
  };
}

// Limites à appliquer maintenant (tout à 0 pendant une suspension)
export async function getEffectiveLimits(): Promise<IgLimits> {
  const l = await getStoredLimits();
  return l.suspended ? { ...l, dm_per_day: 0, follows_per_day: 0, dm_per_hour: 0, dm_interval_sec: 0 } : l;
}
