import { supabase } from '@/lib/supabase';
import { siteRecommendations } from '@/lib/siteAudit';

// Calcul à l'avance des recommandations {recommandations} pour les leads emailing qui ont un site :
// quelques leads par appel (cron du VPS), en parallèle. Site injoignable : liste vide (pas de nouvel essai).
const db = () => supabase as any;

export async function computeSiteRecos(limit = 10, parallel = 5): Promise<{ done: number; empty: number; left: number }> {
  const { data: leads } = await db().from('email_leads').select('id, website, company, sector, city')
    .eq('segment', 'site').is('site_reco_at', null).in('status', ['new', 'in_sequence']).order('created_at').limit(limit);
  let done = 0, empty = 0;
  const queue = [...(leads ?? [])];
  await Promise.all(Array.from({ length: parallel }, async () => {
    for (let l = queue.shift(); l; l = queue.shift()) {
      let recos: { reco: string; constat: string }[] = [];
      try { recos = (await siteRecommendations(l)).recos; } catch { recos = []; }
      await db().from('email_leads').update({ site_reco: recos, site_reco_at: new Date().toISOString() }).eq('id', l.id);
      if (recos.length) done++; else empty++;
    }
  }));
  const { count } = await db().from('email_leads').select('id', { count: 'exact', head: true })
    .eq('segment', 'site').is('site_reco_at', null).in('status', ['new', 'in_sequence']);
  return { done, empty, left: count ?? 0 };
}
