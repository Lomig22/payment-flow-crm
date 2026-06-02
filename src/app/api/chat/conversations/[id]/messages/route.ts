import { NextRequest, NextResponse } from 'next/server';
import { getAuthUser, unauthorized, forbidden, badRequest } from '@/lib/auth-server';
import { supabase } from '@/lib/supabase';

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
  return NextResponse.json(data, { status: 201 });
}
