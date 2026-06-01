'use client';
import { useState, useRef, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Bell, User, LogOut, ChevronRight } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { useAuthStore } from '@/store/authStore';
import { notificationsApi, authApi } from '@/lib/api';
import { getInitials, timeAgo, FIELD_LABELS, STATUS_LABELS } from '@/lib/utils';

interface HeaderProps {
  title:       string;
  onMenuClick: () => void;
}

function formatActivity(entry: any): string {
  if (entry.action_note) return entry.action_note;
  const field = FIELD_LABELS[entry.field_changed] ?? entry.field_changed;
  if (entry.field_changed === 'status') {
    return `Statut → ${STATUS_LABELS[entry.new_value] ?? entry.new_value}`;
  }
  if (['called','appointment_taken','appointment_honored','quote_sent','r2_planned','r3_planned'].includes(entry.field_changed)) {
    return entry.new_value === 'true' ? field : `${field} annulé`;
  }
  if (entry.field_changed) return `${field} modifié`;
  return 'Activité';
}

function getLeadName(entry: any): string {
  const lead = entry.leads;
  if (!lead) return 'Lead supprimé';
  return lead.company || `${lead.first_name} ${lead.last_name}`;
}

export default function Header({ title, onMenuClick }: HeaderProps) {
  const router              = useRouter();
  const { user, clearAuth } = useAuthStore();

  const [notifOpen,   setNotifOpen]   = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [lastSeen,    setLastSeen]    = useState(() =>
    typeof window !== 'undefined'
      ? (localStorage.getItem('pf_notif_seen') ?? '1970-01-01T00:00:00Z')
      : '1970-01-01T00:00:00Z'
  );

  const notifRef   = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);

  // Close dropdowns on outside click
  useEffect(() => {
    function onMouseDown(e: MouseEvent) {
      if (notifRef.current   && !notifRef.current.contains(e.target as Node))   setNotifOpen(false);
      if (profileRef.current && !profileRef.current.contains(e.target as Node)) setProfileOpen(false);
    }
    document.addEventListener('mousedown', onMouseDown);
    return () => document.removeEventListener('mousedown', onMouseDown);
  }, []);

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { setNotifOpen(false); setProfileOpen(false); }
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const { data: notifications = [] } = useQuery({
    queryKey: ['notifications'],
    queryFn:  () => notificationsApi.getRecent().then((r) => r.data as any[]),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const unread = notifications.filter((n) => n.created_at > lastSeen).length;

  const openNotif = () => {
    setNotifOpen((v) => !v);
    setProfileOpen(false);
    const now = new Date().toISOString();
    setLastSeen(now);
    localStorage.setItem('pf_notif_seen', now);
  };

  const openProfile = () => {
    setProfileOpen((v) => !v);
    setNotifOpen(false);
  };

  const handleLogout = async () => {
    setProfileOpen(false);
    try { await authApi.logout(); } catch (_) {}
    clearAuth();
    toast.success('Déconnexion réussie');
    router.push('/login');
  };

  return (
    <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex items-center gap-4 sticky top-0 z-30">
      {/* Mobile menu */}
      <button onClick={onMenuClick} className="lg:hidden p-2 hover:bg-gray-100 rounded-lg">
        <Menu className="w-5 h-5 text-gray-600" />
      </button>

      {/* Title */}
      <h1 className="text-lg font-semibold text-gray-900 flex-shrink-0">{title}</h1>

      <div className="flex items-center gap-2 ml-auto">

        {/* ── Notifications ─────────────────────────── */}
        <div ref={notifRef} className="relative">
          <button
            onClick={openNotif}
            className={`relative p-2 rounded-lg transition-colors ${notifOpen ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
          >
            <Bell className="w-5 h-5 text-gray-500" />
            {unread > 0 && (
              <span className="absolute top-1.5 right-1.5 w-4 h-4 bg-red-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center leading-none">
                {unread > 9 ? '9+' : unread}
              </span>
            )}
            {unread === 0 && (
              <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary-500 rounded-full" />
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 mt-2 w-80 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50">
              <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                <p className="text-sm font-semibold text-gray-900">Activité récente</p>
                {notifications.length > 0 && (
                  <span className="text-xs text-gray-400">{notifications.length} entrées</span>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {notifications.length === 0 ? (
                  <div className="px-4 py-8 text-center text-sm text-gray-400">
                    Aucune activité récente
                  </div>
                ) : (
                  notifications.map((n: any) => (
                    <button
                      key={n.id}
                      onClick={() => { setNotifOpen(false); router.push(`/leads/${n.lead_id}`); }}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                    >
                      <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-600 flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-[10px] font-bold">
                          {getInitials(n.leads?.first_name ?? '?', n.leads?.last_name ?? '')}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-semibold text-gray-900 truncate">{getLeadName(n)}</p>
                        <p className="text-xs text-gray-500 mt-0.5">{formatActivity(n)}</p>
                      </div>
                      <span className="text-[10px] text-gray-400 flex-shrink-0 mt-0.5">{timeAgo(n.created_at)}</span>
                    </button>
                  ))
                )}
              </div>

              <div className="border-t border-gray-100 px-4 py-2.5">
                <button
                  onClick={() => { setNotifOpen(false); router.push('/leads'); }}
                  className="text-xs text-primary-600 hover:text-primary-700 font-medium flex items-center gap-1"
                >
                  Voir tous les leads <ChevronRight className="w-3 h-3" />
                </button>
              </div>
            </div>
          )}
        </div>

        {/* ── Profile ───────────────────────────────── */}
        <div ref={profileRef} className="relative">
          <button
            onClick={openProfile}
            className={`flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-lg transition-colors ${profileOpen ? 'bg-gray-100' : 'hover:bg-gray-100'}`}
          >
            <div className="w-7 h-7 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
              {getInitials(user?.first_name ?? '', user?.last_name ?? '')}
            </div>
            <div className="hidden sm:block text-left">
              <p className="text-xs font-semibold text-gray-900 leading-tight">
                {user?.first_name} {user?.last_name}
              </p>
              <p className="text-[10px] text-gray-400 leading-tight">
                {user?.role === 'admin' ? 'Admin' : 'Setter'}
              </p>
            </div>
          </button>

          {profileOpen && (
            <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-gray-100 overflow-hidden z-50">
              {/* Identity */}
              <div className="px-4 py-3 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-sm font-bold flex-shrink-0">
                    {getInitials(user?.first_name ?? '', user?.last_name ?? '')}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">
                      {user?.first_name} {user?.last_name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">{user?.email}</p>
                  </div>
                </div>
              </div>

              {/* Actions */}
              <div className="py-1">
                <button
                  onClick={() => { setProfileOpen(false); router.push('/profile'); }}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="w-4 h-4 text-gray-400" />
                  Mon profil
                </button>
              </div>

              <div className="border-t border-gray-100 py-1">
                <button
                  onClick={handleLogout}
                  className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Se déconnecter
                </button>
              </div>
            </div>
          )}
        </div>

      </div>
    </header>
  );
}
