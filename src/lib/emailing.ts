import { parse } from 'csv-parse/sync';
import { supabase } from '@/lib/supabase';
import { fetchAll } from '@/lib/fetchAll';
import { parisMidnight } from '@/lib/autoSchedule';
import { trackingFor } from '@/lib/emailTracking';
import { buildVars, renderVars } from '@/lib/emailVars';

// Emailing (sprint50, 14/10/2026). Le CRM est la source de vérité : il choisit qui contacter et
// quand (séquence de 3 mails, arrêt à la réponse, désinscription, rebond, « ne pas contacter »
// commun à tous les canaux). Hermès (Hermes Agent) récupère les mails à envoyer, les rédige,
// les envoie depuis ses boîtes préchauffées et rapporte chaque événement.

const db = () => supabase as any;
const CLAIM_MS = 6 * 3600_000;   // un lead remis à Hermès et jamais rapporté redevient disponible

// Segment du lead : avec site internet (« site ») ou sans (« no_site »), calculé en base depuis website
export type Segment = 'site' | 'no_site';
export const SEGMENTS: Segment[] = ['site', 'no_site'];
export const seqOf = (s: EmailSettings, seg: Segment | null | undefined): EmailStep[] => s.sequences?.[seg ?? 'no_site'] ?? s.steps;

export interface EmailStep { step: number; delay_days: number; subject: string; body: string }
export interface EmailSettings {
  active: boolean; daily_goal: number; steps: EmailStep[];
  sequences: Record<Segment, EmailStep[]> | null;   // un parcours par segment (avec / sans site)
  send_days: number[]; send_from: number; send_to: number; instructions: string;
}

export async function getEmailSettings(): Promise<EmailSettings> {
  const { data } = await db().from('email_settings').select('*').eq('id', 1).single();
  return data;
}

// ── Import ──

const EMAIL = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const norm = (h: string) => h.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const FIELDS: Record<string, string[]> = {
  email:        ['email', 'e_mail', 'mail', 'adresse_email', 'adresse_mail', 'courriel'],
  first_name:   ['prenom', 'first_name', 'firstname'],
  last_name:    ['nom', 'last_name', 'lastname', 'nom_de_famille'],
  company:      ['entreprise', 'societe', 'company', 'raison_sociale', 'nom_entreprise'],
  job_title:    ['poste', 'fonction', 'job_title', 'titre', 'title'],
  sector:       ['secteur', 'activite', 'metier', 'sector', 'industry', 'niche'],
  city:         ['ville', 'city', 'localisation', 'location'],
  phone:        ['telephone', 'tel', 'phone', 'mobile'],
  website:      ['site', 'site_web', 'website', 'url', 'site_internet', 'url_site', 'site_url', 'web'],
  linkedin_url: ['linkedin', 'linkedin_url', 'profil_linkedin'],
};

export interface EmailImportResult { total: number; inserted: number; duplicates: number; invalid: number; dnc: number; errors: string[] }

export async function importEmailCsv(csv: string, sourceFile: string): Promise<EmailImportResult> {
  const delimiter = (csv.split('\n')[0].match(/;/g)?.length ?? 0) > (csv.split('\n')[0].match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: Record<string, string>[] = parse(csv, { columns: (h: string[]) => h.map(norm), skip_empty_lines: true, trim: true, relax_column_count: true, bom: true, delimiter });
  if (!rows.length) throw new Error('Aucune ligne dans le fichier');
  const pick = (r: Record<string, string>, f: string) => FIELDS[f].map((k) => r[k]).find((v) => v && v.trim())?.trim() ?? null;
  if (!rows.some((r) => pick(r, 'email'))) throw new Error('Colonne email introuvable (email, mail, courriel…)');

  const known = new Set(Object.values(FIELDS).flat());
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  const res: EmailImportResult = { total: rows.length, inserted: 0, duplicates: 0, invalid: 0, dnc: 0, errors: [] };
  for (const r of rows) {
    const email = pick(r, 'email')?.toLowerCase().replace(/^mailto:/, '') ?? '';
    if (!EMAIL.test(email)) { res.invalid++; continue; }
    if (seen.has(email)) { res.duplicates++; continue; }
    seen.add(email);
    const custom = Object.fromEntries(Object.entries(r).filter(([k, v]) => !known.has(k) && v));
    out.push({
      email, first_name: pick(r, 'first_name'), last_name: pick(r, 'last_name'), company: pick(r, 'company'),
      job_title: pick(r, 'job_title'), sector: pick(r, 'sector'), city: pick(r, 'city'), phone: pick(r, 'phone'),
      website: pick(r, 'website'), linkedin_url: pick(r, 'linkedin_url'), custom, source_file: sourceFile,
    });
  }

  // Déjà dans l'emailing, ou « ne pas contacter » ailleurs dans le CRM
  const emails = out.map((o) => o.email as string);
  const existing = new Set<string>(), blocked = new Set<string>();
  for (let i = 0; i < emails.length; i += 500) {
    const chunk = emails.slice(i, i + 500);
    const [{ data: a }, { data: b }] = await Promise.all([
      db().from('email_leads').select('email').in('email', chunk),
      db().from('leads').select('email').in('email', chunk).eq('do_not_contact', true),
    ]);
    for (const x of a ?? []) existing.add(String(x.email).toLowerCase());
    for (const x of b ?? []) blocked.add(String(x.email).toLowerCase());
  }
  const fresh = out.filter((o) => !existing.has(o.email as string));
  res.duplicates += out.length - fresh.length;
  for (const o of fresh) if (blocked.has(o.email as string)) { o.status = 'dnc'; res.dnc++; }
  for (let i = 0; i < fresh.length; i += 500) {
    const { error, count } = await db().from('email_leads').insert(fresh.slice(i, i + 500), { count: 'exact' });
    if (error) res.errors.push(error.message); else res.inserted += count ?? 0;
  }
  return res;
}

// ── Hermès : mails à envoyer ──

const parisNow = () => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hourCycle: 'h23', weekday: 'short', hour: '2-digit' })
    .formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { day: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(p.weekday) || 7, hour: Number(p.hour) };
};
const parisMidnightIso = () => parisMidnight(new Date()).toISOString();

export async function sentToday(): Promise<number> {
  const { count } = await db().from('email_events').select('id', { count: 'exact', head: true }).eq('type', 'sent').gte('occurred_at', parisMidnightIso());
  return count ?? 0;
}

export interface EmailTask {
  lead_id: string; step: number; segment: Segment; email: string; mailbox: string | null; thread_id: string | null;
  lead: Record<string, unknown>; template: { subject: string; body: string } | null; previous: { subject: string | null; body: string | null }[];
  tracking: { pixel_url: string; pixel_html: string; unsubscribe_url: string };   // à mettre dans chaque mail
  variables: Record<string, string>;                                               // personnalisation (emailVars.ts)
  rendered: { subject: string; body: string } | null;                              // modèle de Lomig, variables remplacées
}

// Prochains mails à envoyer : relances dues d'abord (une conversation entamée prime), puis premiers
// mails ; dans la limite de l'objectif du jour et des jours et heures d'envoi.
export async function nextTasks(limit: number): Promise<{ tasks: EmailTask[]; reason?: string; sent_today: number; goal: number }> {
  const s = await getEmailSettings();
  const done = await sentToday();
  const base = { sent_today: done, goal: s.daily_goal };
  if (!s.active) return { ...base, tasks: [], reason: 'Envois désactivés dans le CRM' };
  const { day, hour } = parisNow();
  if (!s.send_days.includes(day) || hour < s.send_from || hour >= s.send_to) return { ...base, tasks: [], reason: `Hors plage d'envoi (${s.send_from} h – ${s.send_to} h, jours ${s.send_days.join(',')})` };
  const n = Math.max(0, Math.min(limit, 200, s.daily_goal - done));
  if (!n) return { ...base, tasks: [], reason: 'Objectif du jour atteint' };

  const nowIso = new Date().toISOString(), freeIso = new Date(Date.now() - CLAIM_MS).toISOString();
  const { data: dueRows } = await db().from('email_leads').select('*')
    .eq('status', 'in_sequence').lte('next_send_at', nowIso)
    .or(`claimed_at.is.null,claimed_at.lt.${freeIso}`).order('next_send_at').limit(n * 2);
  // Relance encore prévue dans la séquence de son segment (avec / sans site)
  const followups = (dueRows ?? []).filter((l: any) => l.step < seqOf(s, l.segment).length).slice(0, n);
  const rest = n - (followups?.length ?? 0);
  const { data: firsts } = rest > 0
    ? await db().from('email_leads').select('*').eq('status', 'new').or(`claimed_at.is.null,claimed_at.lt.${freeIso}`).order('created_at').limit(rest)
    : { data: [] };

  const tasks: EmailTask[] = [];
  for (const l of [...(followups ?? []), ...(firsts ?? [])]) {
    // Verrou : un lead n'est remis qu'une fois
    const { data: got } = await db().from('email_leads').update({ claimed_at: nowIso }).eq('id', l.id)
      .or(`claimed_at.is.null,claimed_at.lt.${freeIso}`).select('id');
    if (!got?.length) continue;
    const step = l.step + 1;
    const tpl = seqOf(s, l.segment).find((x) => x.step === step);
    const { data: prev } = l.step ? await db().from('email_events').select('subject, body').eq('lead_id', l.id).eq('type', 'sent').order('occurred_at') : { data: [] };
    tasks.push({
      lead_id: l.id, step, segment: l.segment, email: l.email, mailbox: l.mailbox, thread_id: l.thread_id,
      lead: { first_name: l.first_name, last_name: l.last_name, company: l.company, job_title: l.job_title, sector: l.sector, city: l.city, website: l.website, ...l.custom },
      template: tpl && (tpl.subject || tpl.body) ? { subject: tpl.subject, body: tpl.body } : null,
      // Mail déjà personnalisé par le CRM (variables remplacées) : à envoyer tel quel
      variables: buildVars(l),
      rendered: tpl && (tpl.subject || tpl.body) ? { subject: renderVars(tpl.subject, buildVars(l)), body: renderVars(tpl.body, buildVars(l)) } : null,
      previous: prev ?? [],
      tracking: trackingFor(l.id, step),
    });
  }
  return { ...base, tasks };
}

// ── Hermès : événements ──

export type EmailEventType = 'sent' | 'opened' | 'clicked' | 'replied' | 'bounced' | 'unsubscribed' | 'interested' | 'not_interested' | 'note';
export interface EmailEventIn {
  lead_id?: string; email?: string; type: EmailEventType; step?: number; subject?: string; body?: string;
  mailbox?: string; message_id?: string; thread_id?: string; occurred_at?: string; payload?: Record<string, unknown>;
}
const TYPES: EmailEventType[] = ['sent', 'opened', 'clicked', 'replied', 'bounced', 'unsubscribed', 'interested', 'not_interested', 'note'];
// Statuts qui arrêtent la séquence (aucun nouvel envoi)
const STOP: Record<string, string> = { replied: 'replied', bounced: 'bounced', unsubscribed: 'unsubscribed', interested: 'interested', not_interested: 'not_interested' };

export async function recordEvents(events: EmailEventIn[]): Promise<{ ok: number; errors: { index: number; error: string }[] }> {
  const s = await getEmailSettings();
  const out = { ok: 0, errors: [] as { index: number; error: string }[] };
  for (let index = 0; index < events.length; index++) {
    const e = events[index];
    try {
      if (!TYPES.includes(e.type)) throw new Error(`type inconnu : ${e.type}`);
      const q = db().from('email_leads').select('id, email, status, step, segment, mailbox, thread_id');
      const { data: lead } = e.lead_id ? await q.eq('id', e.lead_id).maybeSingle() : await q.ilike('email', String(e.email ?? '').trim()).maybeSingle();
      if (!lead) throw new Error('lead introuvable (lead_id ou email)');
      const at = e.occurred_at && !Number.isNaN(Date.parse(e.occurred_at)) ? new Date(e.occurred_at).toISOString() : new Date().toISOString();
      const { error } = await db().from('email_events').insert({
        lead_id: lead.id, type: e.type, step: e.step ?? (e.type === 'sent' ? lead.step + 1 : lead.step || null), subject: e.subject ?? null, body: e.body ?? null,
        mailbox: e.mailbox ?? null, message_id: e.message_id ?? null, occurred_at: at, payload: e.payload ?? {},
      });
      if (error) {
        if (error.code === '23505') { out.ok++; continue; }   // déjà reçu (même message_id) : idempotent
        throw new Error(error.message);
      }
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (e.type === 'sent') {
        const step = e.step ?? lead.step + 1;
        const next = seqOf(s, lead.segment).find((x) => x.step === step + 1);
        Object.assign(patch, {
          step, last_sent_at: at, claimed_at: null, mailbox: lead.mailbox ?? e.mailbox ?? null, thread_id: lead.thread_id ?? e.thread_id ?? e.message_id ?? null,
          next_send_at: next ? new Date(Date.parse(at) + next.delay_days * 86_400_000).toISOString() : null,
        });
        // Une réponse ou un arrêt arrivé entre-temps garde la main
        if (['new', 'in_sequence'].includes(lead.status)) patch.status = next ? 'in_sequence' : 'completed';
      } else if (STOP[e.type]) {
        patch.status = STOP[e.type];
        patch.next_send_at = null;
        patch.claimed_at = null;
        if (e.type === 'replied' || e.type === 'interested') patch.replied_at = at;
        if (e.type === 'unsubscribed') await db().from('leads').update({ do_not_contact: true }).ilike('email', String(lead.email)).then(() => null, () => null);
      }
      await db().from('email_leads').update(patch).eq('id', lead.id);
      out.ok++;
    } catch (err: any) {
      out.errors.push({ index, error: err.message });
    }
  }
  return out;
}

// Envoi raté côté Hermès : le lead est rendu sans attendre l'expiration du verrou
export async function releaseTasks(leadIds: string[]): Promise<void> {
  if (leadIds.length) await db().from('email_leads').update({ claimed_at: null }).in('id', leadIds);
}

// ── Tableau de bord ──

// Taux par cohorte : leads ayant reçu au moins un mail depuis `from` → part qui a ouvert, part qui a
// répondu (réponse, intéressé, pas intéressé). Aussi par segment (avec / sans site) et par mail (1, 2…).
interface Rate { contacted: number; opened: number; replied: number; open_rate: number | null; reply_rate: number | null }
const rate = (c: number, o: number, r: number): Rate => ({ contacted: c, opened: o, replied: r, open_rate: c ? o / c : null, reply_rate: c ? r / c : null });
const REPLY = ['replied', 'interested', 'not_interested'];

async function rates(from: string) {
  const events = await fetchAll<{ lead_id: string; type: string; step: number | null }>(() => db().from('email_events')
    .select('lead_id, type, step').in('type', ['sent', 'opened', 'clicked', ...REPLY]).gte('occurred_at', from).order('id'));
  const sent = new Set<string>(), opened = new Set<string>(), replied = new Set<string>();
  const byStep = new Map<number, { sent: Set<string>; opened: Set<string>; replied: Set<string> }>();
  const stepOf = (k: number) => { if (!byStep.has(k)) byStep.set(k, { sent: new Set(), opened: new Set(), replied: new Set() }); return byStep.get(k)!; };
  for (const e of events) {
    const k = e.step ?? 1;
    if (e.type === 'sent') { sent.add(e.lead_id); stepOf(k).sent.add(e.lead_id); }
    else if (REPLY.includes(e.type)) { replied.add(e.lead_id); stepOf(k).replied.add(e.lead_id); }
    else { opened.add(e.lead_id); stepOf(k).opened.add(e.lead_id); }
  }
  // Segment des leads contactés
  const ids = Array.from(sent), seg = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 300) {
    const { data } = await db().from('email_leads').select('id, segment').in('id', ids.slice(i, i + 300));
    for (const r of data ?? []) seg.set(r.id, r.segment);
  }
  const count = (set: Set<string>, keep: (id: string) => boolean) => Array.from(set).filter((id) => sent.has(id) && keep(id)).length;
  const bySeg = Object.fromEntries(SEGMENTS.map((sg) => {
    const inSeg = (id: string) => seg.get(id) === sg;
    return [sg, rate(ids.filter(inSeg).length, count(opened, inSeg), count(replied, inSeg))];
  })) as Record<Segment, Rate>;
  const steps = Array.from(byStep.entries()).sort((x, y) => x[0] - y[0]).map(([k, v]) => {
    const inStep = (id: string) => v.sent.has(id);
    return { step: k, ...rate(v.sent.size, Array.from(v.opened).filter(inStep).length, Array.from(v.replied).filter(inStep).length) };
  });
  return { ...rate(sent.size, count(opened, () => true), count(replied, () => true)), by_segment: bySeg, by_step: steps };
}

export async function emailStats() {
  const since = parisMidnightIso(), week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const count = async (type: string, from: string) =>
    (await db().from('email_events').select('id', { count: 'exact', head: true }).eq('type', type).gte('occurred_at', from)).count ?? 0;
  const statuses = ['new', 'in_sequence', 'replied', 'interested', 'not_interested', 'bounced', 'unsubscribed', 'dnc', 'completed'];
  const byStatus = Object.fromEntries(await Promise.all(statuses.map(async (st) =>
    [st, (await db().from('email_leads').select('id', { count: 'exact', head: true }).eq('status', st)).count ?? 0])));
  const [sentToday, repliedToday, bouncedToday, sentWeek, repliedWeek, bouncedWeek, interestedWeek] = await Promise.all([
    count('sent', since), count('replied', since), count('bounced', since), count('sent', week), count('replied', week), count('bounced', week), count('interested', week),
  ]);
  const { data: last } = await db().from('email_events').select('occurred_at').order('created_at', { ascending: false }).limit(1);
  const s = await getEmailSettings();
  const [r7, r30] = await Promise.all([rates(week), rates(new Date(Date.now() - 30 * 86_400_000).toISOString())]);
  return {
    settings: s, by_status: byStatus, rates: { '7d': r7, '30d': r30 },
    leads_by_segment: Object.fromEntries(await Promise.all(SEGMENTS.map(async (sg) =>
      [sg, (await db().from('email_leads').select('id', { count: 'exact', head: true }).eq('segment', sg)).count ?? 0]))) as Record<Segment, number>,
    today: { sent: sentToday, replied: repliedToday, bounced: bouncedToday },
    week: { sent: sentWeek, replied: repliedWeek, bounced: bouncedWeek, interested: interestedWeek },
    last_event_at: last?.[0]?.occurred_at ?? null,
    agent_configured: !!process.env.EMAILING_AGENT_KEY,
  };
}
