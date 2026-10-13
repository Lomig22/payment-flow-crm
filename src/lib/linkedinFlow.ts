import { supabase } from '@/lib/supabase';
import {
  getLinkedinSettings, nextQuestion, liEvent, notifyLomig, addBusinessDays, linkedinProfileUrl,
  capitalizeName, LI_STATUS_LABELS, type LinkedinSettings, type Question, type Stage,
} from '@/lib/linkedin';
import { writeFirstMessage, writePostRelance, relanceMessage, messageC, checkMessage, type LiProfile } from '@/lib/linkedinAgent';

// Étapes de la séquence LinkedIn partagées par le compte rendu du worker (/api/linkedin/ext/report)
// et la page /linkedin (validation, « ne plus contacter »).

const db = () => supabase as any;
const LEAD = 'id, first_name, last_name, company, job_title, linkedin_url, li_status, li_question, li_profile, li_preview, li_pending, li_msg, li_dm_sent_at, li_last_sent_at, li_last_kind';

// Prochain message : { stage, kind, message, … } ; kind = first | r1 | r2 | r3 | post
export interface Pending {
  stage: Stage; kind: 'first' | 'r1' | 'r2' | 'r3' | 'post'; message: string;
  variante?: string; question?: Question; element_cite?: string; source?: string; confiance?: string; raison?: string;
  generated_at: string;
}

// Message rédigé par l'agent à valider, sauf validation manuelle désactivée
const needsValidation = (s: LinkedinSettings) => s.manual_validation;

// ── Premier message ──
export async function generateFor(leadId: string): Promise<void> {
  const s = await getLinkedinSettings();
  const { data: lead } = await db().from('leads').select(LEAD).eq('id', leadId).maybeSingle();
  if (!s || !lead || lead.li_pending) return;
  if (!lead.li_preview && lead.li_status !== 'connected') return;
  if (!(lead.first_name ?? '').trim()) {
    // Sans prénom, pas de message (« Bonjour , … ») : le lead attend qu'on complète sa fiche
    await db().from('leads').update({ li_preview: false, ...(lead.li_preview ? {} : { li_status: 'failed' }), li_error: 'Prénom manquant : à compléter avant la séquence' }).eq('id', leadId);
    return;
  }
  const q: Question = lead.li_question ?? await nextQuestion(s);
  const out = await writeFirstMessage(lead, (lead.li_profile ?? {}) as LiProfile, q);
  const pending: Pending = { stage: 'first', kind: 'first', ...out, generated_at: new Date().toISOString() };
  const status = lead.li_preview ? lead.li_status : needsValidation(s) ? 'to_validate' : 'ready';
  await db().from('leads').update({
    li_msg: out, li_question: q, li_variant: out.variante, li_pending: pending, li_status: status, li_error: null,
  }).eq('id', leadId);
  await liEvent(leadId, lead.li_status, status,
    `${lead.li_preview ? '[test] ' : ''}premier message rédigé (variante ${out.variante}, ${q}${out.raison ? ` ; ${out.raison}` : ''})`);
}

// ── Relance : relance « post » si le lead a publié depuis le dernier message, sinon R1 / R2 / R3 ──
const NEXT_STAGE: Record<string, Stage> = { first_sent: 'r1', r1_sent: 'r2', r2_sent: 'r3' };

export async function prepareRelance(leadId: string, posts: LiProfile['posts']): Promise<void> {
  const s = await getLinkedinSettings();
  const { data: lead } = await db().from('leads').select(LEAD).eq('id', leadId).maybeSingle();
  const stage = lead && NEXT_STAGE[lead.li_status];
  if (!s || !lead || !stage || lead.li_pending) return;
  const q: Question = lead.li_question ?? 'cout_client';
  const profile: LiProfile = { ...(lead.li_profile ?? {}), posts: posts ?? [] };
  const sinceDays = lead.li_last_sent_at ? (Date.now() - new Date(lead.li_last_sent_at).getTime()) / 86_400_000 : 0;

  const post = await writePostRelance(lead, profile, q, Math.floor(sinceDays));
  const now = new Date().toISOString();
  let pending: Pending, status: string;
  if (post) {
    pending = { stage, kind: 'post', question: q, ...post, generated_at: now };
    status = needsValidation(s) ? 'to_validate' : 'ready';
  } else {
    pending = { stage, kind: stage, question: q, message: relanceMessage(stage as 'r1' | 'r2' | 'r3', lead, q), generated_at: now };
    status = 'ready';
  }
  await db().from('leads').update({ li_pending: pending, li_status: status, li_profile: profile, li_error: null }).eq('id', leadId);
  await liEvent(leadId, lead.li_status, status, post ? `relance post préparée à la place de ${stage.toUpperCase()}` : `${stage.toUpperCase()} préparée`);
}

// ── Envoi réussi ──
export async function markSent(leadId: string, stage: Stage, kind: string) {
  const s = await getLinkedinSettings();
  const { data: lead } = await db().from('leads').select(LEAD).eq('id', leadId).maybeSingle();
  if (!s || !lead) return;
  const now = new Date();
  const first = stage === 'first' ? now : new Date(lead.li_dm_sent_at ?? now);
  const due = stage === 'first' ? addBusinessDays(first, s.r1_days)
    : stage === 'r1' ? addBusinessDays(first, s.r2_days)
    : stage === 'r2' ? addBusinessDays(first, s.r3_days)
    : addBusinessDays(now, s.end_days);
  const status = `${stage}_sent`;
  await db().from('leads').update({
    li_status: status, li_pending: null, li_due_at: due.toISOString(), li_attempts: 0, li_error: null,
    li_last_sent_at: now.toISOString(), li_last_kind: kind,
    ...(stage === 'first' ? { li_dm_sent_at: now.toISOString() } : {}),
  }).eq('id', leadId);
  await liEvent(leadId, lead.li_status, status, `${kind === 'post' ? 'relance post' : kind === 'first' ? 'premier message' : kind.toUpperCase()} envoyé(e) : ${lead.li_pending?.message ?? ''}`);
}

// ── Réponse du lead : arrêt immédiat, « à reprendre », notification ──
export async function markReplied(leadId: string, reply: { text?: string | null; thread_url?: string | null }) {
  const { data: lead } = await db().from('leads').select(LEAD).eq('id', leadId).maybeSingle();
  if (!lead || lead.li_status === 'to_resume' || lead.li_status === 'dnc') return;
  const now = new Date().toISOString();
  // Message qui a déclenché la réponse (aucun si la personne a écrit avant notre premier message)
  const stage = lead.li_last_kind ?? null;
  await db().from('leads').update({
    li_status: 'to_resume', li_pending: null, li_due_at: null, li_replied_at: now, li_replied_stage: stage,
    li_reply_text: reply.text?.slice(0, 2000) ?? null, li_thread_url: reply.thread_url ?? null, li_handled_at: null,
  }).eq('id', leadId);
  await liEvent(leadId, lead.li_status, 'to_resume', `a répondu${reply.text ? ` : ${reply.text.slice(0, 300)}` : ''}`);
  const name = `${capitalizeName(lead.first_name)} ${lead.last_name ?? ''}`.trim();
  const link = reply.thread_url || linkedinProfileUrl(lead.linkedin_url);
  await notifyLomig(`${name} a répondu`, [
    `${name}${lead.company ? ` (${lead.company})` : ''} a répondu sur LinkedIn. La séquence est arrêtée pour ce lead : plus aucun message automatique.`,
    reply.text ? `Sa réponse : ${reply.text}` : 'Réponse détectée dans la conversation.',
    'À vous de reprendre la conversation.',
  ], link ? { label: reply.thread_url ? 'Ouvrir la conversation' : 'Ouvrir le profil', url: link } : undefined);
}

// ── Validation manuelle (file « À valider ») ──
export async function decide(leadId: string, action: 'validate' | 'edit' | 'reject', edited?: string): Promise<{ error?: string }> {
  const s = await getLinkedinSettings();
  const { data: lead } = await db().from('leads').select(LEAD).eq('id', leadId).maybeSingle();
  if (!s || !lead?.li_pending) return { error: 'Aucun message à valider pour ce lead' };
  const p: Pending = lead.li_pending;
  const q: Question = p.question ?? lead.li_question ?? 'cout_client';
  let next: Pending = p;
  if (action === 'edit') {
    const msg = (edited ?? '').trim();
    const issues = checkMessage(msg, { first: p.stage === 'first' });
    if (!msg) return { error: 'Message vide' };
    if (issues.length) return { error: `Message non conforme : ${issues.join(', ')}` };
    next = { ...p, message: msg };
  } else if (action === 'reject') {
    // Rejet : variante C (modèle) pour un premier message, relance prévue pour une relance post
    next = p.stage === 'first'
      ? { ...p, variante: 'C', message: messageC(lead, q), element_cite: '', source: '', confiance: 'haute', raison: 'rejeté par Lomig' }
      : { ...p, kind: p.stage, message: relanceMessage(p.stage as 'r1' | 'r2' | 'r3', lead, q), element_cite: '', source: '' };
  }
  const review = { action, at: new Date().toISOString(), original: action === 'validate' ? undefined : p.message };

  if (lead.li_preview) {
    // Test : rien ne part, on garde seulement l'avis de Lomig sur la qualité
    await db().from('leads').update({ li_preview: false, li_pending: null, li_msg: { ...(lead.li_msg ?? {}), ...next, review } }).eq('id', leadId);
    await liEvent(leadId, null, null, `[test] message ${action === 'validate' ? 'validé' : action === 'edit' ? 'modifié' : 'rejeté'}`);
    return {};
  }
  if (lead.li_status !== 'to_validate') return { error: `Ce lead n'est plus à valider (${LI_STATUS_LABELS[lead.li_status] ?? lead.li_status})` };
  await db().from('leads').update({
    li_status: 'ready', li_pending: next,
    ...(p.stage === 'first' ? { li_msg: { ...(lead.li_msg ?? {}), ...next, review }, li_variant: next.variante ?? lead.li_msg?.variante } : {}),
  }).eq('id', leadId);
  await liEvent(leadId, 'to_validate', 'ready', `message ${action === 'validate' ? 'validé' : action === 'edit' ? 'modifié puis validé' : 'rejeté (variante C)'} : ${next.message}`);

  // Après validation_target décisions, la validation manuelle se désactive (Lomig est prévenu)
  const count = (s.validated_count ?? 0) + 1;
  const off = s.manual_validation && count >= s.validation_target;
  await db().from('linkedin_settings').update({ validated_count: count, ...(off ? { manual_validation: false } : {}) }).eq('id', 1);
  if (off) {
    await notifyLomig('validation manuelle désactivée', [
      `${count} messages validés : les messages rédigés par l'agent partent désormais sans validation.`,
      'Vous pouvez réactiver la validation manuelle dans les réglages de la page LinkedIn.',
    ]);
  }
  return {};
}

// ── Ne plus contacter : le lead et son entreprise, définitivement ──
export const normCompany = (s: string | null | undefined) =>
  (s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/\b(sas|sasu|sarl|eurl|sa|sci|eirl|ei|ets|etablissements)\b/g, '').replace(/[^a-z0-9]+/g, '');

export async function doNotContact(leadId: string): Promise<number> {
  const { data: lead } = await db().from('leads').select('id, company, siren, li_status').eq('id', leadId).maybeSingle();
  if (!lead) return 0;
  const now = new Date().toISOString();
  // Autres leads de la même entreprise (SIREN ou nom), encore dans la séquence ou pas
  const ids = new Set<string>([lead.id]);
  if (lead.siren) {
    const { data } = await db().from('leads').select('id').eq('siren', lead.siren);
    (data ?? []).forEach((l: any) => ids.add(l.id));
  }
  const key = normCompany(lead.company);
  if (key) {
    const { data } = await db().from('leads').select('id, company').ilike('company', `%${(lead.company ?? '').trim().slice(0, 40)}%`).limit(200);
    (data ?? []).filter((l: any) => normCompany(l.company) === key).forEach((l: any) => ids.add(l.id));
  }
  for (const id of Array.from(ids)) {
    const { data: l } = await db().from('leads').select('li_status').eq('id', id).maybeSingle();
    await db().from('leads').update({
      do_not_contact: true, do_not_contact_at: now, li_pending: null, li_due_at: null,
      ...(l?.li_status ? { li_status: 'dnc' } : {}),
    }).eq('id', id);
    await liEvent(id, l?.li_status ?? null, l?.li_status ? 'dnc' : null, id === leadId ? 'ne plus contacter' : 'ne plus contacter (même entreprise)');
  }
  return ids.size;
}
