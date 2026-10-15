import { NextRequest, NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';
import {
  checkExtKey, linkedinSlug, linkedinProfileUrl, linkedinActivityUrl, firstMessageDue, liEvent, blockAccount, cooldownAccount,
  accountEvent, MAX_ATTEMPTS, MESSAGED,
} from '@/lib/linkedin';
import { classifyIncident, inviteDelayMs } from '@/lib/linkedinRamp';
import { generateFor, prepareRelance, markSent, markReplied } from '@/lib/linkedinFlow';
import { ageToDays } from '@/lib/linkedinAgent';

// POST → compte rendu d'une action exécutée par le worker :
//   { type: 'scan',     result: 'ok', slugs: string[] }                       page « Relations »
//   { type: 'inbox',    result: 'ok', replies: [{ name, text, thread_url }] }  conversations dont le dernier message vient du lead
//   { type: 'profile',  lead_id, result: 'ok', profile: { top, about, experience, posts } }
//   { type: 'posts',    lead_id, result: 'ok', posts: [...] }                  avant une relance
//   { type: 'withdraw', lead_id, result: 'ok' | 'not_pending' | 'already_connected' | 'error' }
//   { type: 'invite',   lead_id, result: 'ok' | 'pending' | 'already_connected' | 'error', detail? }
//   { type: 'dm',       lead_id, result: 'ok' | 'existing_thread' | 'not_connected' | 'error', detail? }
//   { type: 'followup', lead_id, result: 'ok' | 'replied' | 'not_connected' | 'error', detail? }
//   { type: 'session',  result: 'ok' | 'auth' }                                connexion LinkedIn du worker
//   { type: 'pending',  result: 'ok', count }                                  invitations en attente (page « Envoyées »)
// Incidents (sprint46), quel que soit le type : 'auth' / 'verify' (déconnexion, captcha, vérification
// d'identité) → compte BLOQUÉ, déblocage manuel ; 'limit' / 'warning' (limite hebdomadaire,
// restriction) ou trop d'erreurs d'affilée → COOLDOWN de 7 jours, −2 paliers, reprise automatique.
export const dynamic     = 'force-dynamic';
export const maxDuration = 120;   // rédaction par l'agent après la visite d'un profil

const INCIDENT_LABEL: Record<string, string> = {
  auth:    'session LinkedIn déconnectée',
  verify:  'captcha ou vérification d\'identité demandée par LinkedIn',
  limit:   'limite LinkedIn atteinte',
  warning: 'avertissement ou restriction affichée par LinkedIn',
};
const normName = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim();

export async function POST(request: NextRequest) {
  const s = await checkExtKey(request);
  if (!s) return NextResponse.json({ message: 'Clé extension invalide' }, { status: 401 });

  const db   = supabase as any;
  const body = await request.json().catch(() => ({}));
  const now  = new Date();
  const iso  = now.toISOString();
  const result = String(body.result ?? 'error');
  const detail = body.detail ? String(body.detail).slice(0, 500) : null;
  const type   = String(body.type ?? '');

  // Délai aléatoire avant la prochaine action : 3 à 12 min (non uniforme) après une invitation,
  // entre min_gap et max_gap minutes sinon
  const gapMs = type === 'invite'
    ? inviteDelayMs(s)
    : (s.min_gap_minutes + Math.random() * Math.max(0, (s.max_gap_minutes ?? s.min_gap_minutes * 2) - s.min_gap_minutes)) * 60_000;
  const setNext = (extra: Record<string, unknown> = {}) => db.from('linkedin_settings')
    .update({ next_action_at: new Date(now.getTime() + gapMs).toISOString(), ...extra }).eq('id', 1);
  const log = (fields: Record<string, unknown>) => db.from('linkedin_log').insert({ action: type, result, detail, ...fields });

  const incident = classifyIncident(result, detail ?? '');
  if (incident) {
    await log({ lead_id: body.lead_id ?? null });
    const reason = `${INCIDENT_LABEL[result] ?? result}${detail ? ` (${detail})` : ''}`;
    if (incident === 'blocked') await blockAccount(reason);
    else await cooldownAccount(s, reason);
    return NextResponse.json({ ok: true, incident });
  }
  // Erreurs inhabituelles en série (pages qui ne chargent plus, boutons introuvables…) : cooldown
  if (result === 'error' && body.detail !== 'note_unavailable') {
    const streak = (s.error_streak ?? 0) + 1;
    if (streak >= s.error_streak_max) {
      await log({ lead_id: body.lead_id ?? null });
      await cooldownAccount(s, `${streak} erreurs d'affilée (dernière : ${detail ?? 'inconnue'})`);
      return NextResponse.json({ ok: true, incident: 'cooldown' });
    }
    await db.from('linkedin_settings').update({ error_streak: streak }).eq('id', 1);
  } else if (s.error_streak) {
    await db.from('linkedin_settings').update({ error_streak: 0 }).eq('id', 1);
  }

  if (type === 'pending') {
    const count = Number(body.count);
    await log({ detail: Number.isFinite(count) ? `${count} invitation(s) en attente` : detail });
    if (result === 'ok' && Number.isFinite(count)) {
      await db.from('linkedin_settings').update({ pending_count: count, pending_count_at: iso }).eq('id', 1);
      if (count >= s.pending_suspend && (s.pending_count ?? 0) < s.pending_suspend) {
        await accountEvent('pending_suspend', `${count} invitations en attente (seuil ${s.pending_suspend}) : nouvelles invitations suspendues`, {
          subject: 'invitations suspendues', lines: [`${count} invitations sont en attente sur LinkedIn (seuil : ${s.pending_suspend}, plafond LinkedIn : ${s.pending_cap}).`, 'Les nouvelles invitations sont suspendues jusqu\'à ce que ce nombre redescende. Retirez les plus anciennes depuis LinkedIn (Réseau → Gérer → Envoyées).'],
        });
      }
    } else {
      await db.from('linkedin_settings').update({ pending_count_at: iso }).eq('id', 1);
    }
    await setNext();
    return NextResponse.json({ ok: true });
  }

  if (type === 'session') {
    await log({});
    return NextResponse.json({ ok: true });
  }

  if (type === 'scan') {
    await db.from('linkedin_settings').update({ last_scan_at: iso }).eq('id', 1);
    if (result !== 'ok') { await log({}); await setNext(); return NextResponse.json({ ok: true }); }
    const slugs = new Set<string>((Array.isArray(body.slugs) ? body.slugs : []).map((x: unknown) => String(x).toLowerCase()));
    const { data: invited } = await db.from('leads').select('id, linkedin_url').eq('li_status', 'invited');
    const accepted = (invited ?? []).filter((l: any) => slugs.has(linkedinSlug(l.linkedin_url) ?? ''));
    for (const l of accepted) {
      await db.from('leads').update({
        li_status: 'connected', li_connected_at: iso, li_due_at: firstMessageDue(s, now).toISOString(), li_error: null,
      }).eq('id', l.id);
      await liEvent(l.id, 'invited', 'connected', 'invitation acceptée');
    }
    await db.from('linkedin_log').insert({ action: 'scan', result: 'ok', detail: `${slugs.size} relations lues, ${accepted.length} acceptation(s)` });
    await setNext();
    return NextResponse.json({ ok: true, accepted: accepted.length });
  }

  if (type === 'inbox') {
    await db.from('linkedin_settings').update({ last_inbox_at: iso }).eq('id', 1);
    if (result !== 'ok') { await log({}); await setNext(); return NextResponse.json({ ok: true }); }
    const replies: { name: string; text?: string; thread_url?: string }[] = Array.isArray(body.replies) ? body.replies : [];
    const { data: watched } = await db.from('leads').select('id, first_name, last_name, li_status')
      .in('li_status', ['connected', 'to_validate', 'ready', ...MESSAGED]);
    let found = 0;
    for (const r of replies) {
      const n = normName(String(r.name ?? ''));
      const matches = (watched ?? []).filter((l: any) => n && normName(`${l.first_name ?? ''} ${l.last_name ?? ''}`) === n);
      if (matches.length !== 1) continue;   // homonymes : la vérification avant relance prendra le relais
      await markReplied(matches[0].id, { text: r.text ?? null, thread_url: r.thread_url ?? null });
      found++;
    }
    // Messages lus (« Vu ») : taux d'ouverture LinkedIn
    let read = 0;
    for (const name of (Array.isArray(body.seen) ? body.seen : []).slice(0, 50)) {
      const n = normName(String(name ?? ''));
      const matches = (watched ?? []).filter((l: any) => n && normName(`${l.first_name ?? ''} ${l.last_name ?? ''}`) === n && MESSAGED.includes(l.li_status));
      if (matches.length !== 1) continue;
      const { data: upd } = await db.from('leads').update({ li_seen_at: iso }).eq('id', matches[0].id).is('li_seen_at', null).select('id');
      if (upd?.length) read++;
    }
    await db.from('linkedin_log').insert({ action: 'inbox', result: 'ok', detail: `${replies.length} conversation(s) à lire, ${found} réponse(s) de leads${read ? `, ${read} message(s) lu(s)` : ''}` });
    await setNext();
    return NextResponse.json({ ok: true, replies: found });
  }

  if (!body.lead_id) return NextResponse.json({ message: 'lead_id requis' }, { status: 400 });
  const { data: lead } = await db.from('leads').select('id, li_status, li_attempts, li_pending, linkedin_url, li_preview, li_profile').eq('id', body.lead_id).maybeSingle();
  if (!lead) return NextResponse.json({ message: 'Lead introuvable' }, { status: 404 });
  await log({ lead_id: lead.id, stage: type === 'dm' ? 'first' : type === 'followup' ? (lead.li_pending?.kind ?? null) : null });

  // Échec : nouvel essai plus tard, « erreur » au bout de MAX_ATTEMPTS
  const fail = async (why: string) => {
    const attempts = (lead.li_attempts ?? 0) + 1;
    const failed = attempts >= MAX_ATTEMPTS;
    await db.from('leads').update({ li_attempts: attempts, li_error: why, ...(failed ? { li_status: 'failed' } : {}) }).eq('id', lead.id);
    if (failed) await liEvent(lead.id, lead.li_status, 'failed', `${type} : ${why}`);
  };

  if (type === 'profile') {
    if (result === 'ok' && body.profile) {
      const posts = (Array.isArray(body.profile.posts) ? body.profile.posts : []).slice(0, 5).map((p: any) => ({
        text: String(p.text ?? '').slice(0, 3000), age: p.age ?? null, age_days: ageToDays(p.age),
        repost: !!p.repost, url: p.url ?? null,
      }));
      const profile = {
        top: String(body.profile.top ?? '').slice(0, 1500), about: String(body.profile.about ?? '').slice(0, 4000),
        experience: String(body.profile.experience ?? '').slice(0, 4000), posts,
        profile_url: linkedinProfileUrl(lead.linkedin_url), activity_url: linkedinActivityUrl(lead.linkedin_url), collected_at: iso,
      };
      await db.from('leads').update({
        li_profile: profile, li_profile_at: iso, li_attempts: 0,
        ...(lead.li_status === 'to_invite' ? { li_visited_at: iso } : {}),
        ...(typeof body.profile.open_profile === 'boolean' ? { li_open_profile: body.profile.open_profile } : {}),
      }).eq('id', lead.id);
      await liEvent(lead.id, null, null, `profil visité (${posts.length} publication(s) lue(s))`);
      await setNext();
      await generateFor(lead.id);
      return NextResponse.json({ ok: true });
    }
    await fail(detail ?? 'Profil illisible');
    await setNext();
    return NextResponse.json({ ok: true });
  }

  if (type === 'posts') {
    if (result === 'ok') {
      const posts = (Array.isArray(body.posts) ? body.posts : []).slice(0, 5).map((p: any) => ({
        text: String(p.text ?? '').slice(0, 3000), age: p.age ?? null, age_days: ageToDays(p.age), repost: !!p.repost, url: p.url ?? null,
      }));
      await setNext();
      await prepareRelance(lead.id, posts);
      return NextResponse.json({ ok: true });
    }
    await fail(detail ?? 'Publications illisibles');
    await setNext();
    return NextResponse.json({ ok: true });
  }

  if (type === 'withdraw') {
    if (result === 'ok' || result === 'not_pending') {
      await db.from('leads').update({ li_status: 'expired', li_expired_at: iso, li_attempts: 0, li_error: null }).eq('id', lead.id);
      await liEvent(lead.id, 'invited', 'expired', result === 'ok' ? 'invitation retirée (en attente depuis trop longtemps)' : 'invitation plus en attente');
    } else if (result === 'already_connected') {
      await db.from('leads').update({ li_status: 'connected', li_connected_at: iso, li_due_at: firstMessageDue(s, now).toISOString(), li_error: null }).eq('id', lead.id);
      await liEvent(lead.id, 'invited', 'connected', 'invitation acceptée');
    } else await fail(detail ?? 'Retrait impossible');
    await setNext();
    return NextResponse.json({ ok: true });
  }

  if (type === 'invite') {
    if (result === 'error' && body.detail === 'note_unavailable') {
      // Compte gratuit : LinkedIn limite les notes personnalisées. Le test « avec note » s'arrête,
      // l'invitation repartira sans note au prochain passage (lead non pénalisé)
      await db.from('linkedin_settings').update({ note_split_pct: 0 }).eq('id', 1);
      await accountEvent('note_unavailable', 'LinkedIn refuse les notes d\'invitation sur ce compte : test « avec note » désactivé', {
        subject: 'notes d\'invitation indisponibles', lines: ['LinkedIn n\'autorise plus de note personnalisée sur ce compte (limite des comptes gratuits). Les invitations continuent sans note ; le test avec note est désactivé.'],
      });
      await setNext();
      return NextResponse.json({ ok: true });
    }
    if (result === 'ok' || result === 'pending') {
      await db.from('leads').update({
        li_status: 'invited', li_invited_at: iso, li_attempts: 0, li_error: null,
        li_inv_variant: body.inv_variant === 'note' ? 'note' : 'no_note', li_inv_note: body.note || null,
      }).eq('id', lead.id);
      await liEvent(lead.id, lead.li_status, 'invited', result === 'ok' ? 'invitation envoyée (sans note)' : 'invitation déjà en attente');
    } else if (result === 'already_connected') {
      await db.from('leads').update({ li_status: 'connected', li_connected_at: iso, li_due_at: firstMessageDue(s, now).toISOString(), li_attempts: 0, li_error: null }).eq('id', lead.id);
      await liEvent(lead.id, lead.li_status, 'connected', 'déjà en relation');
    } else await fail(detail ?? 'Invitation impossible');
    await setNext();
    return NextResponse.json({ ok: true });
  }

  if (type === 'dm' || type === 'followup') {
    const p = lead.li_pending;
    if (result === 'ok' && p) await markSent(lead.id, p.stage, p.kind);
    else if (result === 'existing_thread' || result === 'replied') {
      // Une conversation existe déjà ou le lead a répondu : la suite est pour Lomig
      await markReplied(lead.id, { text: body.reply_text ?? null, thread_url: body.thread_url ?? null });
    } else if (result === 'not_connected') {
      await db.from('leads').update({ li_status: 'failed', li_error: 'Plus en relation' }).eq('id', lead.id);
      await liEvent(lead.id, lead.li_status, 'failed', 'plus en relation au moment de l\'envoi');
    } else await fail(detail ?? 'Envoi impossible');
    await setNext();
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ message: 'type invalide' }, { status: 400 });
}
