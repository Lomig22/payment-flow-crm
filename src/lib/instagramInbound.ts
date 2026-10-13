import { supabase } from '@/lib/supabase';
import { igGet, igPost, loadTokens } from '@/lib/instagramGraph';
import { igProfileUrl } from '@/lib/instagram';

// Phase 4 — captation inbound : commentaires à mot-clé et nouvelles conversations
// → leads inbound attribués au contenu d'origine. Appelé par le cron de synchro.
// En mode Développement de l'app Meta, seuls les comptes ayant un rôle dans l'app
// sont visibles : la captation des vrais prospects démarre après l'App Review.

type Channel = 'comment_keyword' | 'dm_inbound' | 'story_reply';

interface Tok { account_username: string; ig_user_id: string; access_token: string }

interface IgComment { id: string; text?: string; timestamp?: string; username?: string; from?: { id: string; username: string } }
interface IgMessage { from?: { id: string; username?: string }; created_time: string; story?: unknown }

const DAY = 86_400_000;

// Comparaison insensible à la casse et aux accents
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase();

export function matchKeyword(text: string, keywords: string[]): string | null {
  const t = norm(text);
  for (const k of keywords) {
    const re = new RegExp(`(^|[^A-Z0-9])${norm(k).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^A-Z0-9]|$)`);
    if (re.test(t)) return k;
  }
  return null;
}

// Échappe _ et % : ilike sans joker = égalité insensible à la casse
const likeExact = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

// Crée le lead inbound, ou rattache le lead existant (même pseudo Instagram)
async function upsertInboundLead(username: string, channel: Channel, contentId: string | null, note: string): Promise<string | null> {
  const db = supabase as any;
  const { data: existing } = await db.from('leads')
    .select('id, origin, origin_content_id')
    .ilike('instagram_username', likeExact(username))
    .limit(1);

  if (existing?.length) {
    const lead = existing[0];
    // Un prospect déjà contacté en outbound reste outbound ; sinon il devient inbound
    if (!lead.origin) {
      await db.from('leads').update({
        origin: 'inbound', inbound_channel: channel,
        origin_content_id: lead.origin_content_id ?? contentId,
      }).eq('id', lead.id);
    }
    await db.from('lead_history').insert({ lead_id: lead.id, action_note: note });
    return lead.id;
  }

  const now = new Date().toISOString();
  const { data: created, error } = await db.from('leads').insert({
    first_name:         username,
    last_name:          '—',
    instagram_username: username,
    instagram_url:      igProfileUrl(username),
    source:             'instagram',
    status:             'reponse',        // c'est le prospect qui a écrit en premier
    reponse_date:       now,
    action_in_progress: 'follow_up',
    origin:             'inbound',
    inbound_channel:    channel,
    origin_content_id:  contentId,
    notes:              note,
  }).select('id').single();
  if (error || !created) return null;
  await db.from('lead_history').insert({ lead_id: created.id, action_note: `Lead inbound créé automatiquement — ${note}` });
  return created.id;
}

async function settingsFor(account: string): Promise<{ keywords: string[]; auto_reply_text: string | null }> {
  const { data } = await (supabase as any).from('inbound_settings')
    .select('keywords, auto_reply_text').eq('account_username', account).maybeSingle();
  return { keywords: data?.keywords ?? ['BTP', 'AUDIT'], auto_reply_text: data?.auto_reply_text ?? null };
}

// Commentaires : seulement les contenus dont le nombre de commentaires a augmenté
async function syncComments(tok: Tok, keywords: string[], autoReply: string | null) {
  const db = supabase as any;
  const stats = { comments: 0, leads: 0, replies: 0, errors: [] as string[] };

  const { data: contents } = await db.from('ig_content')
    .select('id, ig_media_id, comments')
    .eq('account_username', tok.account_username)
    .in('format', ['reel', 'post', 'carousel'])
    .gte('published_at', new Date(Date.now() - 30 * DAY).toISOString())
    .gt('comments', 0);
  if (!contents?.length) return stats;

  const { data: known } = await db.from('ig_comments')
    .select('id, ig_media_id').in('ig_media_id', contents.map((c: any) => c.ig_media_id));
  const knownIds = new Set<string>((known ?? []).map((k: any) => k.id));
  const countByMedia = new Map<string, number>();
  for (const k of known ?? []) countByMedia.set(k.ig_media_id, (countByMedia.get(k.ig_media_id) ?? 0) + 1);

  for (const c of contents) {
    if ((countByMedia.get(c.ig_media_id) ?? 0) >= c.comments) continue;
    let list: IgComment[] = [];
    try {
      list = (await igGet<{ data: IgComment[] }>(`${c.ig_media_id}/comments`, tok.access_token,
        { fields: 'id,text,timestamp,username,from', limit: '50' })).data;
    } catch (e: any) {
      stats.errors.push(`commentaires ${c.ig_media_id} : ${e.message}`);
      continue;
    }

    for (const cm of list) {
      if (knownIds.has(cm.id)) continue;
      const username = cm.from?.username ?? cm.username ?? null;
      if (!username || username === tok.account_username) continue;
      const keyword = cm.text ? matchKeyword(cm.text, keywords) : null;

      let leadId: string | null = null;
      if (keyword) {
        leadId = await upsertInboundLead(username, 'comment_keyword', c.id,
          `A commenté « ${cm.text} » (mot-clé ${keyword}) sous un contenu Instagram`);
        if (leadId) stats.leads++;
      }

      let replied_at: string | null = null, reply_error: string | null = null;
      if (keyword && autoReply) {
        try {
          await igPost(`${tok.ig_user_id}/messages`, tok.access_token, {
            recipient: JSON.stringify({ comment_id: cm.id }),
            message:   JSON.stringify({ text: autoReply }),
          });
          replied_at = new Date().toISOString();
          stats.replies++;
        } catch (e: any) {
          reply_error = e.message;
        }
      }

      await db.from('ig_comments').upsert({
        id: cm.id, content_id: c.id, ig_media_id: c.ig_media_id, account_username: tok.account_username,
        username, text: cm.text ?? null, commented_at: cm.timestamp ?? null,
        keyword, lead_id: leadId, replied_at, reply_error,
      }, { onConflict: 'id', ignoreDuplicates: true });
      stats.comments++;
    }
  }
  return stats;
}

// Conversations : une nouvelle conversation ouverte par le prospect = lead inbound.
// Premier passage : on enregistre l'existant comme référence, sans créer de leads.
async function syncConversations(tok: Tok) {
  const db = supabase as any;
  const stats = { conversations: 0, leads: 0, errors: [] as string[] };

  const { count } = await db.from('ig_conversations')
    .select('id', { count: 'exact', head: true }).eq('account_username', tok.account_username);
  const baseline = !count;

  let convs: { id: string; updated_time: string; participants?: { data: { id: string; username?: string }[] } }[] = [];
  try {
    convs = (await igGet<{ data: typeof convs }>(`${tok.ig_user_id}/conversations`, tok.access_token,
      { platform: 'instagram', fields: 'id,updated_time,participants', limit: '25' })).data;
  } catch (e: any) {
    stats.errors.push(`conversations : ${e.message}`);
    return stats;
  }
  if (!convs.length) return stats;

  const { data: known } = await db.from('ig_conversations').select('id').in('id', convs.map((c) => c.id));
  const knownIds = new Set<string>((known ?? []).map((k: any) => k.id));

  for (const conv of convs) {
    if (knownIds.has(conv.id)) {
      await db.from('ig_conversations').update({ last_message_at: conv.updated_time }).eq('id', conv.id);
      continue;
    }
    const other = conv.participants?.data.find((p) => p.id !== tok.ig_user_id && p.username !== tok.account_username);
    if (!other?.username) continue;

    let channel: Channel | 'outbound' = 'outbound';
    let firstAt: string | null = null;
    try {
      const m = await igGet<{ messages?: { data: IgMessage[]; paging?: { next?: string } } }>(
        conv.id, tok.access_token, { fields: 'messages.limit(50){from,created_time,story}' });
      const msgs = m.messages?.data ?? [];
      const oldest = msgs[msgs.length - 1];
      firstAt = oldest?.created_time ?? null;
      // Conversation entièrement visible et ouverte par le prospect
      if (oldest && !m.messages?.paging?.next && oldest.from?.id !== tok.ig_user_id && oldest.from?.username !== tok.account_username) {
        channel = oldest.story ? 'story_reply' : 'dm_inbound';
      }
    } catch (e: any) {
      stats.errors.push(`conversation ${conv.id} : ${e.message}`);
      continue;
    }

    let leadId: string | null = null;
    if (!baseline && channel !== 'outbound') {
      leadId = await upsertInboundLead(other.username, channel, null,
        channel === 'story_reply' ? 'A répondu à une story Instagram' : 'A envoyé un DM Instagram');
      if (leadId) stats.leads++;
    }

    await db.from('ig_conversations').upsert({
      id: conv.id, account_username: tok.account_username,
      participant_id: other.id, participant_username: other.username,
      channel, first_message_at: firstAt, last_message_at: conv.updated_time, lead_id: leadId,
    }, { onConflict: 'id', ignoreDuplicates: true });
    stats.conversations++;
  }
  return stats;
}

export async function syncInbound() {
  const results = [];
  for (const tok of await loadTokens()) {
    const s = await settingsFor(tok.account_username);
    const comments = await syncComments(tok, s.keywords, s.auto_reply_text);
    const convs    = await syncConversations(tok);
    results.push({
      account:       tok.account_username,
      comments:      comments.comments,
      conversations: convs.conversations,
      leads:         comments.leads + convs.leads,
      replies:       comments.replies,
      errors:        [...comments.errors, ...convs.errors],
    });
  }
  return results;
}
