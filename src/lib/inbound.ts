import Anthropic from '@anthropic-ai/sdk';
import { supabase } from '@/lib/supabase';
import { notifyLomig } from '@/lib/linkedin';
import { matchKeyword, upsertInboundLead } from '@/lib/instagramInbound';

// Inbound (sprint47) : toutes les interactions (commentaires Instagram et Facebook, abonnements, DM)
// au même endroit, /inbound. Un commentaire est rapproché du mot-clé de SON reel (« Commente
// « SIMULATEUR » … » dans la légende) et des mots-clés généraux ; sinon Claude juge s'il exprime
// un intérêt (question, demande de prix, de la ressource…). Mot-clé ou intérêt → lead + e-mail.

const db = () => supabase as any;
const CLASSIFIER = 'claude-haiku-4-5-20251001';

export interface Interaction {
  id: string; platform: 'instagram' | 'facebook'; kind: 'comment' | 'follow' | 'dm' | 'story_reply';
  content_queue_id?: string | null; media_ref?: string | null; permalink?: string | null; content_caption?: string | null;
  author_name?: string | null; author_handle?: string | null; author_id?: string | null;
  text?: string | null; occurred_at?: string | null;
}

// « 💬 Commente « SIMULATEUR » pour recevoir… » → SIMULATEUR
export function reelKeyword(caption: string | null | undefined): string | null {
  const m = (caption ?? '').match(/comment(?:e|ez)\s*[«"“']?\s*([A-Za-zÀ-ÿ0-9]{2,30})\s*[»"”']?/i);
  return m ? m[1].toUpperCase() : null;
}
export const firstLine = (caption: string | null | undefined) => (caption ?? '').split('\n').map((l) => l.trim()).find(Boolean)?.slice(0, 120) ?? null;

export async function inboundKeywords(): Promise<string[]> {
  const { data } = await db().from('inbound_settings').select('keywords').limit(1).maybeSingle();
  return data?.keywords ?? ['DEVIS', 'AUDIT'];
}

// Intérêt « en périphérie » du mot-clé : Claude classe un lot de commentaires (interest / other)
export async function classifyInterest(items: { id: string; text: string; keyword: string | null; caption: string | null }[])
  : Promise<Map<string, { intent: 'interest' | 'other'; reason: string }>> {
  const out = new Map<string, { intent: 'interest' | 'other'; reason: string }>();
  if (!items.length || !process.env.ANTHROPIC_API_KEY) return out;
  const prompt = `Tu tries des commentaires laissés sous les vidéos de Lomig, qui aide les artisans et dirigeants de TPE à obtenir des demandes de devis en ligne. Les vidéos invitent à commenter un mot-clé pour recevoir une ressource (stratégie, simulateur…).
Pour chaque commentaire, réponds "interest" si la personne montre un intérêt commercial ou veut la ressource sans écrire exactement le mot-clé : variante ou faute de frappe du mot-clé, « info », « intéressé », « je veux », question sur le prix, le fonctionnement, ses résultats, demande de contact, « mp », description de son activité ou de son besoin. Sinon "other" (compliment, emoji seul, blague, avis, spam, mention d'un ami sans intérêt).
Réponds uniquement en JSON : [{"id": "...", "intent": "interest" | "other", "reason": "quelques mots"}]

${items.map((i) => `- id=${i.id} | mot-clé du reel : ${i.keyword ?? 'aucun'} | vidéo : ${i.caption ?? '?'} | commentaire : ${JSON.stringify(i.text.slice(0, 400))}`).join('\n')}`;
  try {
    const res = await new Anthropic().messages.create({ model: CLASSIFIER, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
    const text = (res.content as any[]).find((b) => b.type === 'text')?.text ?? '';
    const json = JSON.parse(text.slice(text.indexOf('['), text.lastIndexOf(']') + 1));
    for (const r of json) if (r?.id && (r.intent === 'interest' || r.intent === 'other')) out.set(String(r.id), { intent: r.intent, reason: String(r.reason ?? '').slice(0, 200) });
  } catch (e) {
    console.error('Classement des commentaires impossible', e);
  }
  return out;
}

// Lead Facebook : nom affiché par Facebook, rattaché aux interactions précédentes du même auteur
async function facebookLead(i: Interaction, note: string): Promise<string | null> {
  if (i.author_id) {
    const { data } = await db().from('inbound_interactions').select('lead_id').eq('author_id', i.author_id).not('lead_id', 'is', null).limit(1);
    if (data?.[0]?.lead_id) {
      await db().from('lead_history').insert({ lead_id: data[0].lead_id, action_note: note });
      return data[0].lead_id;
    }
  }
  const [first, ...rest] = (i.author_name ?? 'Inconnu Facebook').trim().split(/\s+/);
  const now = new Date().toISOString();
  const { data: created, error } = await db().from('leads').insert({
    first_name: first, last_name: rest.join(' ') || '—', source: 'facebook', status: 'reponse', reponse_date: now,
    action_in_progress: 'follow_up', origin: 'inbound', inbound_channel: 'comment_keyword', notes: note,
  }).select('id').single();
  if (error || !created) return null;
  await db().from('lead_history').insert({ lead_id: created.id, action_note: `Lead inbound créé automatiquement — ${note}` });
  return created.id;
}

// Lead créé à la main depuis la feuille Inbound (interaction jugée sans intérêt, abonné…)
export async function leadForInteraction(id: string): Promise<string | null> {
  const { data: i } = await db().from('inbound_interactions').select('*').eq('id', id).maybeSingle();
  if (!i) return null;
  if (i.lead_id) return i.lead_id;
  const note = `${i.kind === 'follow' ? 'Abonné' : i.kind === 'comment' ? `A commenté « ${(i.text ?? '').slice(0, 300)} »` : 'A écrit en DM'} (${i.platform === 'facebook' ? 'Facebook' : 'Instagram'}) — ajouté depuis la feuille Inbound`;
  const lead = i.platform === 'facebook' ? await facebookLead(i, note)
    : i.author_handle ? await upsertInboundLead(i.author_handle, 'comment_keyword', null, note) : null;
  if (lead) await db().from('inbound_interactions').update({ lead_id: lead }).eq('id', id);
  return lead;
}

// Enregistre des commentaires (déjà filtrés : nouveaux), les qualifie, crée les leads, prévient Lomig
export async function recordComments(list: Interaction[], makeIgLead: (i: Interaction, note: string) => Promise<string | null>): Promise<{ recorded: number; leads: number }> {
  if (!list.length) return { recorded: 0, leads: 0 };
  const globalKeywords = await inboundKeywords();
  const { data: s } = await db().from('inbound_settings').select('classify_interest').limit(1).maybeSingle();
  const rows = list.map((i) => {
    const own = reelKeyword(i.content_caption);
    const keyword = i.text ? matchKeyword(i.text, [...(own ? [own] : []), ...globalKeywords]) : null;
    return { ...i, own, keyword };
  });
  const toClassify = rows.filter((r) => !r.keyword && r.text?.trim());
  const judged = s?.classify_interest === false ? new Map() : await classifyInterest(toClassify.map((r) => ({ id: r.id, text: r.text!, keyword: r.own, caption: firstLine(r.content_caption) })));

  let leads = 0;
  const alerts: string[] = [];
  for (const r of rows) {
    const j = judged.get(r.id);
    const intent = r.keyword ? 'keyword' : j?.intent ?? 'other';
    let lead_id: string | null = null;
    if (intent !== 'other') {
      const where = `${r.platform === 'facebook' ? 'Facebook' : 'Instagram'}${r.content_caption ? ` (« ${firstLine(r.content_caption)} »)` : ''}`;
      const note = `A commenté « ${(r.text ?? '').slice(0, 300)} » sous un contenu ${where}${r.keyword ? ` — mot-clé ${r.keyword}` : ` — intérêt : ${j?.reason ?? ''}`}`;
      lead_id = r.platform === 'facebook' ? await facebookLead(r, note) : await makeIgLead(r, note);
      if (lead_id) leads++;
      alerts.push(`• ${r.author_name ?? r.author_handle ?? '?'} sur ${where} : « ${(r.text ?? '').slice(0, 200)} »${r.keyword ? ` (mot-clé ${r.keyword})` : ' (intérêt)'}${r.permalink ? `\n  ${r.permalink}` : ''}`);
    }
    const { own: _own, ...row } = r;
    await db().from('inbound_interactions').upsert({
      ...row, keyword: r.keyword, intent, intent_reason: r.keyword ? `mot-clé ${r.keyword}` : j?.reason ?? null, lead_id,
      notified_at: intent !== 'other' ? new Date().toISOString() : null,
    }, { onConflict: 'id', ignoreDuplicates: true });
  }
  if (alerts.length) {
    await notifyLomig(`${alerts.length} commentaire(s) à traiter`, [
      'De nouveaux commentaires montrent un intérêt sous tes contenus. Les leads sont créés dans le CRM (page Inbound).',
      alerts.join('\n'),
    ]).catch(() => {});
  }
  return { recorded: rows.length, leads };
}

// ── Facebook : commentaires des Reels et publications de la Page (30 derniers jours) ──
const FB = 'https://graph.facebook.com/v23.0';
async function fbGet(path: string, token: string, params: Record<string, string> = {}): Promise<any> {
  const u = new URL(path.startsWith('http') ? path : `${FB}/${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  if (!u.searchParams.has('access_token')) u.searchParams.set('access_token', token);
  const r = await fetch(u, { cache: 'no-store' });
  const b = await r.json();
  if (b.error) throw new Error(b.error.message);
  return b;
}

export async function syncFacebookComments(): Promise<{ recorded: number; leads: number; error?: string }> {
  const { data: tok } = await db().from('platform_tokens').select('data').eq('platform', 'facebook').maybeSingle();
  const fb = tok?.data;
  const now = new Date().toISOString();
  const setStatus = (fields: Record<string, unknown>) => db().from('inbound_settings').update(fields).neq('account_username', '');
  if (!fb?.access_token || fb.enabled === false) return { recorded: 0, leads: 0, error: 'Page Facebook non connectée' };
  try {
    const since = Math.floor((Date.now() - 30 * 86_400_000) / 1000);
    const fields = 'id,created_time,permalink_url,description,message,comments.summary(true).limit(50){id,from,message,created_time,permalink_url}';
    const [reels, posts] = await Promise.all([
      fbGet(`${fb.page_id}/video_reels`, fb.access_token, { fields: fields.replace(',message,', ','), since: String(since), limit: '50' }),
      fbGet(`${fb.page_id}/feed`, fb.access_token, { fields, since: String(since), limit: '50' }),
    ]);
    const items = [...(reels.data ?? []), ...(posts.data ?? [])].filter((p: any) => p.comments?.data?.length);
    // Reel Facebook → reel de la file (cross-post), pour retrouver la légende et le mot-clé
    const { data: queue } = await db().from('content_queue').select('id, caption, crosspost')
      .not('crosspost->facebook->>id', 'is', null).gte('published_at', new Date(since * 1000).toISOString());
    const byFbId = new Map<string, any>((queue ?? []).map((q: any) => [String(q.crosspost.facebook.id), q]));
    const fresh: Interaction[] = [];
    const ids = items.flatMap((p: any) => p.comments.data.map((c: any) => `fb:${c.id}`));
    const { data: known } = ids.length ? await db().from('inbound_interactions').select('id').in('id', ids) : { data: [] };
    const seen = new Set((known ?? []).map((k: any) => k.id));
    for (const p of items) {
      const q = byFbId.get(String(p.id).split('_').pop() ?? '');
      const caption = q?.caption ?? p.description ?? p.message ?? null;
      for (const c of p.comments.data) {
        if (seen.has(`fb:${c.id}`) || c.from?.id === fb.page_id) continue;   // déjà vu, ou réponse de la Page
        fresh.push({
          id: `fb:${c.id}`, platform: 'facebook', kind: 'comment', content_queue_id: q?.id ?? null, media_ref: String(p.id),
          permalink: c.permalink_url ?? p.permalink_url ?? null, content_caption: caption,
          author_name: c.from?.name ?? null, author_id: c.from?.id ?? null, text: c.message ?? null, occurred_at: c.created_time ?? null,
        });
      }
    }
    const r = await recordComments(fresh, async () => null);
    await setStatus({ fb_last_sync_at: now, fb_last_error: null });
    return r;
  } catch (e: any) {
    await setStatus({ fb_last_sync_at: now, fb_last_error: e.message.slice(0, 500) });
    return { recorded: 0, leads: 0, error: e.message };
  }
}
