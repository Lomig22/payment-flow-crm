import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

// GET — list the current user's conversations with last message + unread count
export async function GET(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const db = supabase as any;

  // 1. Get membership records (tells us which convs the user is in + last_read_at)
  const { data: memberships, error: mErr } = await db
    .from('conversation_members')
    .select('conversation_id, last_read_at')
    .eq('user_id', user.id);

  if (mErr) return NextResponse.json({ message: mErr.message }, { status: 500 });
  if (!memberships || memberships.length === 0) return NextResponse.json([]);

  const convIds: string[] = memberships.map((m: any) => m.conversation_id);
  const lastReadMap: Record<string, string | null> = {};
  memberships.forEach((m: any) => { lastReadMap[m.conversation_id] = m.last_read_at; });

  // 2. Get conversations with all members
  const { data: convs, error: cErr } = await db
    .from('conversations')
    .select(`
      id, name, is_group, updated_at,
      conversation_members ( user_id, users!user_id ( id, first_name, last_name ) )
    `)
    .in('id', convIds)
    .order('updated_at', { ascending: false });

  if (cErr) return NextResponse.json({ message: cErr.message }, { status: 500 });

  // 3. Get most recent messages across all conversations in one query
  const { data: recentMsgs } = await db
    .from('messages')
    .select('id, conversation_id, content, created_at, sender_id')
    .in('conversation_id', convIds)
    .order('created_at', { ascending: false })
    .limit(convIds.length * 3);

  // 4. Get unread messages (sent since oldest last_read_at, not by me)
  const oldest = memberships.reduce(
    (min: string, m: any) => (!m.last_read_at || m.last_read_at < min ? (m.last_read_at ?? '1970-01-01') : min),
    new Date().toISOString()
  );
  const { data: unreadMsgs } = await db
    .from('messages')
    .select('id, conversation_id, created_at')
    .in('conversation_id', convIds)
    .neq('sender_id', user.id)
    .gte('created_at', oldest);

  // Build last-message map (first occurrence per conv = most recent)
  const lastMsgMap: Record<string, any> = {};
  (recentMsgs ?? []).forEach((m: any) => {
    if (!lastMsgMap[m.conversation_id]) lastMsgMap[m.conversation_id] = m;
  });

  // Build unread count map
  const unreadMap: Record<string, number> = {};
  (unreadMsgs ?? []).forEach((m: any) => {
    const lr = lastReadMap[m.conversation_id];
    if (!lr || m.created_at > lr) {
      unreadMap[m.conversation_id] = (unreadMap[m.conversation_id] ?? 0) + 1;
    }
  });

  const result = (convs ?? []).map((c: any) => ({
    ...c,
    last_read_at: lastReadMap[c.id] ?? null,
    last_message: lastMsgMap[c.id] ?? null,
    unread_count: unreadMap[c.id] ?? 0,
  }));

  return NextResponse.json(result);
}

// POST — create a DM or group conversation
export async function POST(request: NextRequest) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  const { member_ids, name, is_group } = await request.json();

  if (!Array.isArray(member_ids) || member_ids.length === 0) {
    return badRequest('Au moins un membre requis');
  }

  const db = supabase as any;

  // For 1-on-1 DMs: reuse existing conversation if one already exists
  if (!is_group && member_ids.length === 1) {
    const otherId = member_ids[0];

    const { data: myMemberships } = await db
      .from('conversation_members')
      .select('conversation_id')
      .eq('user_id', user.id);

    const myConvIds = (myMemberships ?? []).map((m: any) => m.conversation_id);

    if (myConvIds.length > 0) {
      const { data: shared } = await db
        .from('conversation_members')
        .select('conversation_id, conversations!inner(is_group)')
        .eq('user_id', otherId)
        .in('conversation_id', myConvIds);

      const existing = (shared ?? []).find((s: any) => s.conversations?.is_group === false);
      if (existing) return NextResponse.json({ id: existing.conversation_id, existing: true });
    }
  }

  // Create conversation
  const { data: conv, error: convErr } = await db
    .from('conversations')
    .insert({
      name: is_group ? (name?.trim() || 'Groupe') : null,
      is_group: !!is_group,
      created_by: user.id,
    })
    .select()
    .single();

  if (convErr) return NextResponse.json({ message: convErr.message }, { status: 500 });

  // Add all members (creator + selected users)
  const allIds = [user.id, ...member_ids.filter((id: string) => id !== user.id)];
  const { error: membErr } = await db
    .from('conversation_members')
    .insert(allIds.map((uid: string) => ({ conversation_id: conv.id, user_id: uid })));

  if (membErr) return NextResponse.json({ message: membErr.message }, { status: 500 });

  return NextResponse.json({ id: conv.id, existing: false }, { status: 201 });
}
