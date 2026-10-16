import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';
import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { recordEvents, type EmailEventIn } from '@/lib/emailing';

// Lecture des réponses dans la boîte d'envoi de Lomig (Gmail, IMAP, lecture seule) : chaque message
// reçu d'un lead de l'emailing devient un événement (réponse, intéressé, pas intéressé, désinscription),
// chaque retour « adresse introuvable » un rebond. Réponses automatiques d'absence ignorées.
// Mot de passe d'application Gmail : GMAIL_APP_PASSWORD (compte Google > Sécurité, pas Google Cloud).

const db = () => supabase as any;
const CLASSIFIER = 'claude-haiku-4-5-20251001';

const AUTO = /(absen(t|ce)|out of office|autoreply|auto-reply|r[ée]ponse automatique|automatic reply|en cong[ée]s?|vacances)/i;
const STOP = /^\s*(stop|unsubscribe|d[ée]sinscri|ne plus (me )?(contacter|recevoir)|retirez[- ]moi|supprimez[- ]moi)/i;

// Intérêt d'une réponse humaine (Claude Haiku), par défaut « réponse » simple
async function classify(text: string): Promise<'interested' | 'not_interested' | 'unsubscribed' | 'replied'> {
  if (STOP.test(text)) return 'unsubscribed';
  if (!process.env.ANTHROPIC_API_KEY) return 'replied';
  try {
    const r = await new Anthropic().messages.create({
      model: CLASSIFIER, max_tokens: 10,
      system: 'Tu classes la réponse d\'un artisan à un mail de prospection (offre : plus de demandes de devis). Réponds par un seul mot : interested (intéressé, veut en savoir plus, propose un appel, demande un prix), not_interested (refus, pas besoin), unsubscribed (demande à ne plus être contacté), replied (autre réponse, question neutre).',
      messages: [{ role: 'user', content: text.slice(0, 3000) }],
    });
    const w = ((r.content[0] as any)?.text ?? '').trim().toLowerCase();
    return (['interested', 'not_interested', 'unsubscribed'].includes(w) ? w : 'replied') as any;
  } catch { return 'replied'; }
}

// Texte de la réponse sans la citation du mail d'origine
const stripQuote = (t: string) => t.split(/\n(?:le .{3,80}a écrit ?:|on .{3,80}wrote:|-----\s*original message|de ?: .*\n.*envoy[ée] ?:)/i)[0].trim();

export async function checkInbox(): Promise<{ read: number; events: number; error?: string }> {
  const pass = process.env.GMAIL_APP_PASSWORD;
  const { data: s } = await db().from('email_settings').select('sender_email, imap_last_uid').eq('id', 1).single();
  if (!pass || !s?.sender_email) return { read: 0, events: 0, error: 'GMAIL_APP_PASSWORD ou adresse d\'envoi manquante' };

  const client = new ImapFlow({ host: 'imap.gmail.com', port: 993, secure: true, auth: { user: s.sender_email, pass: pass.replace(/\s+/g, '') }, logger: false });
  let lastUid = Number(s.imap_last_uid) || 0, read = 0;
  const events: EmailEventIn[] = [];
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      // Premier passage : on part des 7 derniers jours ; ensuite, des messages arrivés depuis
      const range = lastUid ? `${lastUid + 1}:*` : null;
      const uids: number[] = range
        ? ((await client.search({ uid: range } as any, { uid: true })) || []).filter((u: number) => u > lastUid)
        : ((await client.search({ since: new Date(Date.now() - 7 * 86_400_000) }, { uid: true })) || []);
      for (const uid of uids.slice(0, 200)) {
        const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
        lastUid = Math.max(lastUid, uid);
        if (!msg || !(msg as any).source) continue;
        read++;
        const mail = await simpleParser((msg as any).source);
        const from = (mail.from?.value?.[0]?.address ?? '').toLowerCase();
        const subject = mail.subject ?? '';
        const text = stripQuote(mail.text ?? '');
        const auto = String(mail.headers.get('auto-submitted') ?? '').toLowerCase();
        // Rebond : adresse introuvable (Mail Delivery Subsystem) → destinataire d'origine
        if (/mailer-daemon|postmaster/i.test(from)) {
          const to = ((mail.text ?? '').match(/[\w.+-]+@[\w-]+\.[\w.-]+/g) ?? []).map((x: string) => x.toLowerCase())
            .find((x: string) => x !== s.sender_email.toLowerCase() && !/mailer-daemon|postmaster|@google\.com$/.test(x));
          if (to && /introuvable|not found|does not exist|n'existe pas|unknown user|no such user|address couldn/i.test(mail.text ?? '')) {
            events.push({ email: to, type: 'bounced', body: (mail.text ?? '').slice(0, 1000), message_id: mail.messageId ?? undefined });
          }
          continue;
        }
        if ((auto && auto !== 'no') || AUTO.test(subject)) continue;
        const { data: lead } = await db().from('email_leads').select('id, status').ilike('email', from).maybeSingle();
        if (!lead) continue;   // pas un lead de l'emailing
        events.push({ lead_id: lead.id, type: await classify(text), subject, body: text.slice(0, 4000), message_id: mail.messageId ?? undefined, occurred_at: (mail.date ?? new Date()).toISOString() });
      }
    } finally { lock.release(); }
    await client.logout();
  } catch (e: any) {
    await db().from('email_settings').update({ imap_error: String(e?.message ?? e).slice(0, 300), imap_checked_at: new Date().toISOString() }).eq('id', 1);
    return { read, events: 0, error: e?.message };
  }
  const r = events.length ? await recordEvents(events) : { ok: 0, errors: [] };
  await db().from('email_settings').update({ imap_last_uid: lastUid, imap_checked_at: new Date().toISOString(), imap_error: null }).eq('id', 1);
  return { read, events: r.ok };
}
