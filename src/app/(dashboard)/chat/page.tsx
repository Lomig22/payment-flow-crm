'use client';
import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MessageSquarePlus, Send, Users, X, Check, ChevronLeft } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { chatApi, usersApi } from '@/lib/api';
import { getInitials, timeAgo } from '@/lib/utils';
import Spinner from '@/components/ui/Spinner';
import type { Conversation, Message } from '@/types';

/* ── Helpers ────────────────────────────────────────────────────────── */

function convName(conv: Conversation, myId: string): string {
  if (conv.is_group) return conv.name ?? 'Groupe';
  const other = conv.conversation_members.find((m) => m.user_id !== myId);
  if (other?.users) return `${other.users.first_name} ${other.users.last_name}`;
  return 'Conversation';
}

function convInitials(conv: Conversation, myId: string): string {
  if (conv.is_group) return conv.name?.[0]?.toUpperCase() ?? 'G';
  const other = conv.conversation_members.find((m) => m.user_id !== myId);
  if (other?.users) return getInitials(other.users.first_name, other.users.last_name);
  return '?';
}

/* ── New conversation modal ─────────────────────────────────────────── */

interface NewConvModalProps {
  onClose:   () => void;
  onCreated: (convId: string) => void;
}

function NewConvModal({ onClose, onCreated }: NewConvModalProps) {
  const [selected,   setSelected]   = useState<string[]>([]);
  const [groupName,  setGroupName]  = useState('');
  const { user: me } = useAuthStore();
  const qc = useQueryClient();

  const { data: users = [], isLoading } = useQuery({
    queryKey: ['users-all'],
    queryFn:  () => usersApi.getAll().then((r) => r.data as any[]),
  });

  const others = (users as any[]).filter((u: any) => u.id !== me?.id && u.is_active);

  const toggle = (id: string) =>
    setSelected((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const createMutation = useMutation({
    mutationFn: () =>
      chatApi.createConversation({
        member_ids: selected,
        name:       selected.length > 1 ? (groupName.trim() || 'Groupe') : undefined,
        is_group:   selected.length > 1,
      }).then((r) => r.data),
    onSuccess: (data: any) => {
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
      onCreated(data.id);
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-sm flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Nouvelle conversation</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3 overflow-y-auto flex-1">
          {selected.length > 1 && (
            <input
              autoFocus
              type="text"
              placeholder="Nom du groupe"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              className="input w-full text-sm"
            />
          )}

          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            Membres
          </p>

          {isLoading && <div className="flex justify-center py-4"><Spinner className="w-5 h-5" /></div>}

          {others.map((u: any) => (
            <button
              key={u.id}
              onClick={() => toggle(u.id)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-left transition-colors ${
                selected.includes(u.id)
                  ? 'bg-indigo-50 ring-1 ring-indigo-200'
                  : 'hover:bg-gray-50'
              }`}
            >
              <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
                {getInitials(u.first_name, u.last_name)}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {u.first_name} {u.last_name}
                </p>
                <p className="text-xs text-gray-400">{u.role === 'admin' ? 'Admin' : 'Setter'}</p>
              </div>
              {selected.includes(u.id) && (
                <Check className="w-4 h-4 text-indigo-600 flex-shrink-0" />
              )}
            </button>
          ))}
        </div>

        {/* Footer */}
        <div className="px-4 pb-4 flex gap-2 justify-end flex-shrink-0 border-t border-gray-100 pt-3">
          <button onClick={onClose} className="btn-secondary text-sm">Annuler</button>
          <button
            onClick={() => createMutation.mutate()}
            disabled={selected.length === 0 || createMutation.isPending}
            className="btn-primary text-sm"
          >
            {createMutation.isPending ? 'Création…' : selected.length > 1 ? 'Créer le groupe' : 'Démarrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Message bubble ─────────────────────────────────────────────────── */

function Bubble({
  msg, isMe, showSender,
}: {
  msg: Message; isMe: boolean; showSender: boolean;
}) {
  return (
    <div className={`flex items-end gap-2 ${isMe ? 'flex-row-reverse' : ''}`}>
      {/* Avatar (only for others) */}
      {!isMe && (
        <div className="w-6 h-6 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-[10px] font-bold flex-shrink-0 mb-0.5">
          {msg.users ? getInitials(msg.users.first_name, msg.users.last_name) : '?'}
        </div>
      )}

      <div className={`flex flex-col gap-0.5 max-w-[72%] ${isMe ? 'items-end' : 'items-start'}`}>
        {showSender && !isMe && msg.users && (
          <span className="text-[10px] text-gray-500 font-medium px-1">
            {msg.users.first_name} {msg.users.last_name}
          </span>
        )}
        <div
          className={`px-3 py-2 text-sm leading-relaxed whitespace-pre-wrap break-words ${
            isMe
              ? 'bg-indigo-600 text-white rounded-2xl rounded-br-sm'
              : 'bg-white border border-gray-200 text-gray-900 rounded-2xl rounded-bl-sm shadow-sm'
          }`}
        >
          {msg.content}
        </div>
        <span className="text-[10px] text-gray-400 px-1">{timeAgo(msg.created_at)}</span>
      </div>
    </div>
  );
}

/* ── Chat page ──────────────────────────────────────────────────────── */

export default function ChatPage() {
  const { user }   = useAuthStore();
  const qc         = useQueryClient();

  const [activeId,          setActiveId]          = useState<string | null>(null);
  const [showModal,         setShowModal]          = useState(false);
  const [input,             setInput]             = useState('');
  const [mobileShowThread,  setMobileShowThread]  = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef       = useRef<HTMLTextAreaElement>(null);

  /* ── Conversations list (poll every 5s) */
  const { data: conversations = [], isLoading: convsLoading } = useQuery({
    queryKey: ['chat-conversations'],
    queryFn:  () => chatApi.getConversations().then((r) => r.data as Conversation[]),
    refetchInterval: 5000,
  });

  /* ── Messages for active conversation (poll every 2s) */
  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ['chat-messages', activeId],
    queryFn:  () => chatApi.getMessages(activeId!).then((r) => r.data as Message[]),
    enabled:  !!activeId,
    refetchInterval: 2000,
    refetchIntervalInBackground: false,
  });

  /* Auto-scroll to bottom on new messages */
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  /* Mark as read */
  const markRead = useMutation({
    mutationFn: (id: string) => chatApi.markRead(id),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['chat-conversations'] }),
  });

  const openConversation = useCallback((id: string) => {
    setActiveId(id);
    setMobileShowThread(true);
    markRead.mutate(id);
    setTimeout(() => inputRef.current?.focus(), 150);
  }, []); // eslint-disable-line

  /* Send message */
  const sendMsg = useMutation({
    mutationFn: (content: string) => chatApi.sendMessage(activeId!, content),
    onSuccess: () => {
      setInput('');
      qc.invalidateQueries({ queryKey: ['chat-messages', activeId] });
      qc.invalidateQueries({ queryKey: ['chat-conversations'] });
    },
  });

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed || !activeId || sendMsg.isPending) return;
    sendMsg.mutate(trimmed);
  };

  const handleKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const activeConv = conversations.find((c) => c.id === activeId) ?? null;

  /* ── Render ── */
  return (
    <div className="flex flex-1 h-full overflow-hidden">

      {/* ═══ Conversation list ═══════════════════════════════════════ */}
      <aside
        className={`w-full sm:w-72 flex-shrink-0 bg-white border-r border-gray-200 flex flex-col
          ${mobileShowThread ? 'hidden sm:flex' : 'flex'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 flex-shrink-0">
          <h2 className="text-sm font-semibold text-gray-900">Messages</h2>
          <button
            onClick={() => setShowModal(true)}
            className="p-1.5 hover:bg-indigo-50 text-gray-500 hover:text-indigo-600 rounded-lg transition-colors"
            title="Nouvelle conversation"
          >
            <MessageSquarePlus className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="flex-1 overflow-y-auto">
          {convsLoading && (
            <div className="flex justify-center py-10"><Spinner className="w-5 h-5" /></div>
          )}

          {!convsLoading && conversations.length === 0 && (
            <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
                <MessageSquarePlus className="w-5 h-5 text-gray-400" />
              </div>
              <p className="text-sm text-gray-500 font-medium">Aucune conversation</p>
              <button
                onClick={() => setShowModal(true)}
                className="mt-3 text-xs text-indigo-600 hover:text-indigo-700 font-medium"
              >
                Démarrer une discussion
              </button>
            </div>
          )}

          {conversations.map((conv) => {
            const isActive  = conv.id === activeId;
            const name      = convName(conv, user?.id ?? '');
            const initials  = convInitials(conv, user?.id ?? '');
            const preview   = conv.last_message?.content ?? 'Aucun message';
            const time      = conv.last_message ? timeAgo(conv.last_message.created_at) : '';
            const hasUnread = conv.unread_count > 0;

            return (
              <button
                key={conv.id}
                onClick={() => openConversation(conv.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left border-b border-gray-50 transition-colors ${
                  isActive ? 'bg-indigo-50' : 'hover:bg-gray-50'
                }`}
              >
                {/* Avatar */}
                <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0 ${
                  conv.is_group
                    ? 'bg-purple-100 text-purple-700'
                    : 'bg-primary-100 text-primary-700'
                }`}>
                  {conv.is_group ? <Users className="w-4 h-4" /> : initials}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-1">
                    <p className={`text-sm truncate ${hasUnread ? 'font-bold text-gray-900' : 'font-medium text-gray-800'}`}>
                      {name}
                    </p>
                    {time && (
                      <span className={`text-[10px] flex-shrink-0 ${hasUnread ? 'text-indigo-500 font-semibold' : 'text-gray-400'}`}>
                        {time}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center justify-between gap-1 mt-0.5">
                    <p className={`text-xs truncate ${hasUnread ? 'text-gray-700 font-medium' : 'text-gray-400'}`}>
                      {preview}
                    </p>
                    {hasUnread && (
                      <span className="w-4 h-4 bg-indigo-600 text-white text-[9px] font-bold rounded-full flex items-center justify-center flex-shrink-0 leading-none">
                        {conv.unread_count > 9 ? '9+' : conv.unread_count}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      </aside>

      {/* ═══ Message thread ══════════════════════════════════════════ */}
      <main
        className={`flex-1 flex flex-col bg-gray-50 min-w-0
          ${mobileShowThread ? 'flex' : 'hidden sm:flex'}`}
      >
        {activeConv ? (
          <>
            {/* Thread header */}
            <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center gap-3 flex-shrink-0 shadow-sm">
              <button
                onClick={() => setMobileShowThread(false)}
                className="sm:hidden p-1 -ml-1 hover:bg-gray-100 rounded-lg"
              >
                <ChevronLeft className="w-5 h-5 text-gray-600" />
              </button>

              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 ${
                activeConv.is_group ? 'bg-purple-100 text-purple-700' : 'bg-primary-100 text-primary-700'
              }`}>
                {activeConv.is_group ? <Users className="w-4 h-4" /> : convInitials(activeConv, user?.id ?? '')}
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-gray-900 truncate">
                  {convName(activeConv, user?.id ?? '')}
                </p>
                {activeConv.is_group && (
                  <p className="text-xs text-gray-400">
                    {activeConv.conversation_members.length} membres ·{' '}
                    {activeConv.conversation_members
                      .map((m) => m.users ? m.users.first_name : '')
                      .filter(Boolean)
                      .join(', ')}
                  </p>
                )}
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {msgsLoading && (
                <div className="flex justify-center py-8"><Spinner className="w-5 h-5" /></div>
              )}

              {!msgsLoading && messages.length === 0 && (
                <div className="flex items-center justify-center h-full">
                  <p className="text-sm text-gray-400">Aucun message. Lancez la conversation !</p>
                </div>
              )}

              {messages.map((msg, i) => {
                const isMe       = msg.sender_id === user?.id;
                const prevMsg    = messages[i - 1];
                const showSender = activeConv.is_group && (!prevMsg || prevMsg.sender_id !== msg.sender_id);
                return (
                  <Bubble key={msg.id} msg={msg} isMe={isMe} showSender={showSender} />
                );
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Input */}
            <div className="bg-white border-t border-gray-200 px-4 py-3 flex items-end gap-2 flex-shrink-0">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKey}
                placeholder="Écrire un message… (Entrée pour envoyer, Maj+Entrée pour sauter une ligne)"
                className="flex-1 resize-none rounded-xl border border-gray-200 px-3 py-2.5 text-sm leading-relaxed
                           focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-transparent
                           placeholder:text-gray-400 max-h-40"
                rows={1}
              />
              <button
                onClick={handleSend}
                disabled={!input.trim() || sendMsg.isPending}
                className="p-2.5 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-200 disabled:cursor-not-allowed
                           text-white rounded-xl transition-colors flex-shrink-0"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          </>
        ) : (
          /* Empty state */
          <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
            <div className="w-16 h-16 bg-indigo-50 rounded-full flex items-center justify-center mb-4">
              <MessageSquarePlus className="w-7 h-7 text-indigo-400" />
            </div>
            <h3 className="text-sm font-semibold text-gray-700">Aucune conversation ouverte</h3>
            <p className="text-xs text-gray-400 mt-1 mb-4">Sélectionnez une conversation ou créez-en une nouvelle</p>
            <button onClick={() => setShowModal(true)} className="btn-primary text-sm">
              Nouvelle conversation
            </button>
          </div>
        )}
      </main>

      {/* ═══ New conversation modal ══════════════════════════════════ */}
      {showModal && (
        <NewConvModal
          onClose={()   => setShowModal(false)}
          onCreated={(id) => openConversation(id)}
        />
      )}
    </div>
  );
}
