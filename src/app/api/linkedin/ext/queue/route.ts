import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  checkExtKey, inWorkingHours, countToday, countInvitesWeek, linkedinProfileUrl, linkedinActivityUrl, capitalizeName, accountEvent,
  liEvent, LI_CONNECTIONS_URL, LI_INBOX_URL, SCAN_EVERY_MS, PROFILE_FRESH_MS, MESSAGED,
} from '@/lib/linkedin';
import { generateFor } from '@/lib/linkedinFlow';
import { ensureDayPlan, ensureInviteSlots } from '@/lib/linkedinRampServer';
import { parisClock, weeklyCap, fmtMin } from '@/lib/linkedinRamp';

// GET → la prochaine action du worker (une seule par appel), par ordre de priorité :
//   scan     : relire la page « Relations » (acceptations), toutes les 2 h s'il y a des invitations
//   inbox    : lire la messagerie (réponses), toutes les inbox_every_minutes
//   withdraw : retirer une invitation en attente depuis invite_expiry_days
//   profile  : visiter le profil et les publications d'un lead qui vient d'accepter
//   dm       : envoyer un premier message validé et arrivé à échéance
//   followup : envoyer une relance prête (R1 / R2 / R3 ou relance « post »)
//   posts    : avant une relance, regarder si le lead a publié depuis le dernier message
//   invite   : inviter le prochain lead (montée en charge, 100 / semaine glissante)
// Séquence désactivée : seules les visites de test (leads « aperçu ») sont servies, sans aucun envoi.
// Une action distribuée « réserve » le créneau 3 min (next_action_at) ; le compte rendu fixe
// ensuite le vrai délai, aléatoire.
export const dynamic     = 'force-dynamic';
export const maxDuration = 60;

const LEASE_MS = 3 * 60_000;
const WATCHED = ['connected', 'to_validate', 'ready', ...MESSAGED];   // une réponse arrête la séquence

export async function GET(request: NextRequest) {
  const s = await checkExtKey(request);
  if (!s) return NextResponse.json({ message: 'Clé extension invalide' }, { status: 401 });

  const db  = supabase as any;
  const now = new Date();
  const iso = now.toISOString();
  await db.from('linkedin_settings').update({ last_seen_at: iso }).eq('id', 1);

  const idle  = (reason: string) => NextResponse.json({ next: null, reason });
  const serve = async (next: Record<string, unknown>) => {
    await db.from('linkedin_settings').update({ next_action_at: new Date(now.getTime() + LEASE_MS).toISOString() }).eq('id', 1);
    return NextResponse.json({ next });
  };

  // Une seule session LinkedIn à la fois : le premier robot vu garde la main tant qu'il se manifeste
  const workerId = request.headers.get('x-worker-id') ?? 'extension';
  if (s.worker_id && s.worker_id !== workerId && s.last_seen_at && now.getTime() - new Date(s.last_seen_at).getTime() < 5 * 60_000) {
    return idle(`Une autre session LinkedIn est déjà active (${s.worker_id}) : ce robot reste à l'arrêt`);
  }
  {
    const ip = (request.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || null;
    const ips = (s.worker_ips ?? []).filter((x) => now.getTime() - new Date(x.at).getTime() < 7 * 86_400_000 && x.ip !== ip);
    await db.from('linkedin_settings').update({
      worker_id: workerId, worker_ip: ip, worker_proxy: request.headers.get('x-worker-proxy') === '1',
      worker_ips: ip ? [...ips, { ip, at: iso }] : ips,
    }).eq('id', 1);
  }

  // État du compte : bloqué (déblocage manuel), cooldown (reprise automatique à l'échéance)
  if (s.account_state === 'blocked' || s.stop_reason) return idle(`Compte bloqué : ${s.stop_reason ?? 'à débloquer dans /linkedin'}`);
  if (s.account_state === 'cooldown') {
    if (s.cooldown_until && new Date(s.cooldown_until) > now) return idle(`Cooldown jusqu'au ${new Date(s.cooldown_until).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}`);
    await db.from('linkedin_settings').update({ account_state: 'active', cooldown_until: null, alert: null, alert_at: null }).eq('id', 1);
    await accountEvent('resumed', `Fin du cooldown : reprise au palier ${s.tier}`, {
      subject: 'reprise après cooldown', lines: [`Le cooldown est terminé : la séquence LinkedIn reprend au palier ${s.tier}.`],
    });
    s.account_state = 'active';
  }
  // Fenêtre d'activité : elle ne limite que les invitations (et ce qui les entoure). Acceptations,
  // réponses et messages tournent à toute heure : le premier message part dès que son délai
  // après l'acceptation est écoulé (demande de Lomig, 14/10/2026)
  const open = inWorkingHours(s, now);
  if (s.next_action_at && new Date(s.next_action_at) > now) return idle('Pause entre deux actions');

  // Leads « aperçu » (test de qualité des messages) : visite du profil seulement, jamais d'envoi
  const previewNext = async () => {
    const { data } = await db.from('leads').select('id, linkedin_url, li_profile_at')
      .eq('li_preview', true).is('li_pending', null).limit(1);
    const lead = data?.[0];
    if (!lead) return null;
    if (lead.li_profile_at && now.getTime() - new Date(lead.li_profile_at).getTime() < PROFILE_FRESH_MS) {
      await generateFor(lead.id);   // profil déjà lu : on rédige directement
      return null;
    }
    const url = linkedinProfileUrl(lead.linkedin_url);
    return url ? serve({ type: 'profile', lead_id: lead.id, url, activity_url: linkedinActivityUrl(lead.linkedin_url) }) : null;
  };

  if (!s.enabled) return (await previewNext()) ?? idle('Séquence désactivée dans le CRM');

  // Palier du jour (évalué une fois par jour) et plan du jour (cible, sessions)
  const r = await ensureDayPlan(s, now);
  Object.assign(s, r);

  // Fin de séquence : R3 envoyée et toujours sans réponse après end_days jours ouvrés
  {
    const { data: ended } = await db.from('leads').select('id').eq('li_status', 'r3_sent').lte('li_due_at', iso);
    for (const l of ended ?? []) {
      await db.from('leads').update({ li_status: 'no_reply', li_due_at: null }).eq('id', l.id);
      await liEvent(l.id, 'r3_sent', 'no_reply', 'séquence terminée sans réponse');
    }
  }

  // 1. Acceptations
  const { count: pending } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('li_status', 'invited');
  const scanStale = !s.last_scan_at || now.getTime() - new Date(s.last_scan_at).getTime() > SCAN_EVERY_MS
    || parisClock(new Date(s.last_scan_at)).date !== parisClock(now).date;   // première lecture de la journée
  if ((pending ?? 0) > 0 && scanStale) {
    return serve({ type: 'scan', url: LI_CONNECTIONS_URL });
  }

  // 2. Réponses : la messagerie, pour tous les leads avec qui une conversation est possible
  if (!s.last_inbox_at || now.getTime() - new Date(s.last_inbox_at).getTime() > s.inbox_every_minutes * 60_000) {
    const { data: watched } = await db.from('leads').select('first_name, last_name').in('li_status', WATCHED).limit(500);
    const names = (watched ?? []).map((l: any) => `${l.first_name ?? ''} ${l.last_name ?? ''}`.trim()).filter(Boolean);
    if (names.length) return serve({ type: 'inbox', url: LI_INBOX_URL, names });
  }

  // 3. Invitations en attente depuis trop longtemps : retrait (dans la fenêtre seulement)
  if (open) {
    const limit = new Date(now.getTime() - s.invite_expiry_days * 86_400_000).toISOString();
    const { data } = await db.from('leads').select('id, linkedin_url').eq('li_status', 'invited').lte('li_invited_at', limit)
      .order('li_invited_at', { ascending: true }).limit(1);
    const lead = data?.[0];
    const url = lead && linkedinProfileUrl(lead.linkedin_url);
    if (url) return serve({ type: 'withdraw', lead_id: lead.id, url });
  }

  // 4. Profil des leads qui viennent d'accepter (une seule visite par lead)
  {
    const { data } = await db.from('leads').select('id, linkedin_url, li_profile_at')
      .eq('li_status', 'connected').is('li_pending', null).order('li_connected_at', { ascending: true }).limit(5);
    for (const lead of data ?? []) {
      if (lead.li_profile_at && now.getTime() - new Date(lead.li_profile_at).getTime() < PROFILE_FRESH_MS) {
        await generateFor(lead.id);   // profil déjà lu (aperçu, rédaction échouée…) : on rédige seulement
        continue;
      }
      const url = linkedinProfileUrl(lead.linkedin_url);
      if (url) return serve({ type: 'profile', lead_id: lead.id, url, activity_url: linkedinActivityUrl(lead.linkedin_url) });
    }
  }

  const messagesLeft = s.dms_per_day - await countToday('message');

  // 5. Messages prêts et arrivés à échéance (premier message validé, relance)
  if (messagesLeft > 0) {
    const { data } = await db.from('leads').select('id, linkedin_url, li_pending')
      .eq('li_status', 'ready').lte('li_due_at', iso).order('li_due_at', { ascending: true }).limit(1);
    const lead = data?.[0];
    const url = lead && linkedinProfileUrl(lead.linkedin_url);
    if (lead && url && lead.li_pending?.message) {
      return serve({ type: lead.li_pending.stage === 'first' ? 'dm' : 'followup', lead_id: lead.id, url, message: lead.li_pending.message });
    }
  }

  // 6. Relance arrivée à échéance : d'abord regarder ses nouvelles publications
  if (messagesLeft > 0) {
    const { data } = await db.from('leads').select('id, linkedin_url')
      .in('li_status', ['first_sent', 'r1_sent', 'r2_sent']).lte('li_due_at', iso).is('li_pending', null)
      .order('li_due_at', { ascending: true }).limit(1);
    const lead = data?.[0];
    const url = lead && linkedinActivityUrl(lead.linkedin_url);
    if (url) return serve({ type: 'posts', lead_id: lead.id, url });
  }

  if (!open) return idle('Hors fenêtre des invitations : rien d\'autre à faire pour l\'instant');

  // 7. Invitations en attente sur LinkedIn : relevé quotidien (page « Invitations envoyées »)
  if (!s.pending_count_at || now.getTime() - new Date(s.pending_count_at).getTime() > 20 * 3600_000) {
    return serve({ type: 'pending', url: 'https://www.linkedin.com/mynetwork/invitation-manager/sent/' });
  }

  // 8. Invitations : chacune à son heure exacte (plan.slots), dans la cible du jour, le plafond sur
  // 7 jours glissants et la limite d'invitations en attente
  Object.assign(s, await ensureInviteSlots(s, now));
  const sentToday = await countToday('invite');
  const capLeft = weeklyCap(s) - await countInvitesWeek();
  const slots = [...(s.day_plan?.slots ?? [])].sort((a, b) => a.at.localeCompare(b.at));
  const due = slots.find((x) => new Date(x.at) <= now);
  const room = slots.length;
  const hm = (iso: string) => { const m = parisClock(new Date(iso)).minutes; return fmtMin(m); };
  let block: string | null = capLeft <= 0 ? `plafond de ${weeklyCap(s)} invitations sur 7 jours glissants atteint`
    : s.day_plan && sentToday >= s.day_plan.target ? `cible du jour atteinte (${sentToday}/${s.day_plan.target})`
    : (s.pending_count ?? 0) >= s.pending_suspend ? `${s.pending_count} invitations en attente (≥ ${s.pending_suspend}) : nouveaux envois suspendus`
    : !due ? (slots.length ? `prochaine invitation à ${hm(slots[0].at)}` : 'aucune invitation planifiée (file vide ou sessions du jour terminées)')
    : null;

  // Visite des profils 1 à 2 jours avant l'invitation (une visite par lead, quelques-unes par jour)
  if (s.previsit_enabled && s.day_plan) {
    const { count: visitsToday } = await db.from('linkedin_log').select('id', { count: 'exact', head: true })
      .eq('action', 'profile').eq('result', 'ok').gte('created_at', new Date(now.getTime() - 12 * 3600_000).toISOString());
    if ((visitsToday ?? 0) < s.day_plan.target + 5) {
      const { data } = await db.from('leads').select('id, linkedin_url')
        .eq('li_status', 'to_invite').eq('do_not_contact', false).is('li_visited_at', null).is('li_profile_at', null)
        .order('li_enqueued_at', { ascending: true, nullsFirst: false }).range(room, room + s.day_plan.target * 2);
      const lead = data?.[0];
      const url = lead && linkedinProfileUrl(lead.linkedin_url);
      // Entre deux sessions d'invitations aussi : une visite n'est pas une invitation
      if (url) return serve({ type: 'profile', lead_id: lead.id, url, activity_url: linkedinActivityUrl(lead.linkedin_url) });
    }
  }

  if (!block && due) {
    // Le lead dont l'heure est arrivée (le plus en retard d'abord)
    const { data } = await db.from('leads').select('id, linkedin_url, first_name, company, li_sector, li_status')
      .eq('id', due.lead_id).eq('li_status', 'to_invite').eq('do_not_contact', false).limit(1);
    const lead = data?.[0];
    if (!lead) return idle('Créneau obsolète : replanifié au prochain passage');
    if (lead) {
      const url = linkedinProfileUrl(lead.linkedin_url);
      if (!url) {
        await db.from('leads').update({ li_status: 'failed', li_error: 'URL LinkedIn invalide' }).eq('id', lead.id);
        await liEvent(lead.id, 'to_invite', 'failed', 'URL LinkedIn invalide');
        return idle('URL LinkedIn invalide, lead écarté');
      }
      // Test de l'invitation : avec note (texte du secteur) ou sans note, selon note_split_pct
      const template = (s.note_templates?.[lead.li_sector ?? ''] || s.note_templates?.default || '').trim();
      const withNote = !!template && Math.random() * 100 < s.note_split_pct;
      const note = withNote
        ? template.replace(/\{prenom\}/gi, capitalizeName(lead.first_name)).replace(/\{entreprise\}/gi, (lead.company ?? '').trim())
          .replace(/[ \t]{2,}/g, ' ').trim().slice(0, 200)
        : '';
      return serve({ type: 'invite', lead_id: lead.id, url, message: note, inv_variant: note ? 'note' : 'no_note' });
    }
  }

  return (await previewNext()) ?? idle(block ?? 'Rien à faire pour le moment');
}
