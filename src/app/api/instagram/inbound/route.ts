import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// Captation inbound : derniers commentaires / conversations captés + réglages
// (mots-clés de CTA, réponse privée automatique).
export const dynamic = 'force-dynamic';

async function account(): Promise<string> {
  const { data } = await (supabase as any).from('instagram_tokens').select('account_username').order('account_username').limit(1);
  return data?.[0]?.account_username ?? 'lomig_guegueniat';
}

export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const db = supabase as any;
  const username = await account();
  const [settings, comments, convs] = await Promise.all([
    db.from('inbound_settings').select('keywords, auto_reply_text').eq('account_username', username).maybeSingle(),
    db.from('ig_comments')
      .select('id, username, text, commented_at, keyword, lead_id, replied_at, reply_error, ig_content ( permalink, caption )')
      .eq('account_username', username)
      .order('commented_at', { ascending: false, nullsFirst: false })
      .limit(30),
    db.from('ig_conversations')
      .select('id, participant_username, channel, first_message_at, lead_id')
      .eq('account_username', username)
      .neq('channel', 'outbound')
      .order('first_message_at', { ascending: false, nullsFirst: false })
      .limit(20),
  ]);
  const err = settings.error ?? comments.error ?? convs.error;
  if (err) return NextResponse.json({ message: err.message }, { status: 500 });

  return NextResponse.json({
    account:       username,
    settings:      settings.data ?? { keywords: ['BTP', 'AUDIT'], auto_reply_text: null },
    comments:      comments.data ?? [],
    conversations: convs.data ?? [],
  });
}

export async function PUT(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();
  if (user.role !== 'admin') return forbidden();

  const { keywords, auto_reply_text } = await request.json();
  const list = (Array.isArray(keywords) ? keywords : [])
    .map((k: unknown) => String(k).trim()).filter(Boolean).slice(0, 20);
  if (!list.length) return badRequest('Au moins un mot-clé');
  if (auto_reply_text && String(auto_reply_text).length > 1000) return badRequest('Réponse trop longue (1 000 caractères max)');

  const { data, error } = await (supabase as any).from('inbound_settings').upsert({
    account_username: await account(),
    keywords:         list,
    auto_reply_text:  auto_reply_text ? String(auto_reply_text).trim() : null,
    updated_at:       new Date().toISOString(),
  }).select('keywords, auto_reply_text').single();
  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data);
}
