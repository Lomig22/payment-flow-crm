import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';
import { sendChatNotification } from '@/lib/email';

async function checkMembership(convId: string, userId: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from('conversation_members')
    .select('user_id')
    .eq('conversation_id', convId)
    .eq('user_id', userId)
    .single();
  return !!data;
}

// GET — fetch messages for a conversation (last 100, oldest first)
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  if (!(await checkMembership(params.id, user.id))) return forbidden();

  const { data, error } = await (supabase as any)
    .from('messages')
    .select('id, conversation_id, content, created_at, sender_id, users!sender_id( id, first_name, last_name )')
    .eq('conversation_id', params.id)
    .order('created_at', { ascending: true })
    .limit(100);

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });
  return NextResponse.json(data ?? []);
}

// POST — send a message
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } }
) {
  const user = await getAuthUser(request);
  if (!user) return unauthorized();

  if (!(await checkMembership(params.id, user.id))) return forbidden();

  const { content } = await request.json();
  if (!content?.trim()) return badRequest('Message vide');

  const { data, error } = await (supabase as any)
    .from('messages')
    .insert({
      conversation_id: params.id,
      sender_id: user.id,
      content: content.trim(),
    })
    .select('id, conversation_id, content, created_at, sender_id')
    .single();

  if (error) return NextResponse.json({ message: error.message }, { status: 500 });

  // Fire-and-forget email notifications to admin users (except sender)
  notifyAdmins(params.id, user.id, content.trim()).catch(() => {});

  return NextResponse.json(data, { status: 201 });
}

async function notifyAdmins(convId: string, senderId: string, content: string) {
  const db = supabase as any;

  // Get sender name + admin recipients in parallel
  const [{ data: senderData }, { data: convData }, { data: admins }] = await Promise.all([
    db.from('users').select('first_name, last_name').eq('id', senderId).single(),
    db.from('conversations')
      .select('name, is_group, conversation_members(user_id, users!user_id(first_name, last_name))')
      .eq('id', convId)
      .single(),
    db.from('users').select('email').eq('role', 'admin').eq('is_active', true).neq('id', senderId),
  ]);

  if (!admins?.length) return;

  const senderName = senderData
    ? `${senderData.first_name} ${senderData.last_name}`
    : 'Un membre';

  // Build conversation display name
  let convName = 'Conversation';
  if (convData) {
    if (convData.is_group && convData.name) {
      convName = convData.name;
    } else if (!convData.is_group) {
      const other = (convData.conversation_members as any[])
        ?.find((m: any) => m.user_id !== senderId);
      if (other?.users) {
        convName = `${other.users.first_name} ${other.users.last_name}`;
      }
    }
  }

  await Promise.allSettled(
    admins.map((admin: { email: string }) =>
      sendChatNotification({
        to: admin.email,
        senderName,
        conversationName: convName,
        content,
      })
    )
  );
}
