'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Upload, UsersRound, LogOut, Zap, User, X,
  MessageSquare, BarChart3, BookOpen, Instagram, Phone, Facebook,
  Users, Kanban, ChevronDown, Award,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

function NavLink({ href, icon: Icon, label, onClick, exact = false }: {
  href: string; icon: React.ElementType; label: string; onClick?: () => void; exact?: boolean;
}) {
  const pathname = usePathname();
  // `exact` pour les liens globaux (ex. /leads) qui sont préfixes de leurs
  // sous-pages (/leads/qualiopi…). Sinon match avec frontière « / » pour ne pas
  // déborder sur les pôles voisins.
  const isActive = exact
    ? pathname === href
    : pathname === href || (href.length > 1 && pathname.startsWith(href + '/'));
  return (
    <Link href={href} onClick={onClick} className={cn('nav-link', isActive && 'active')}>
      <Icon className="w-4 h-4 flex-shrink-0" />
      {label}
      {isActive && <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-600" />}
    </Link>
  );
}

function PoleSection({ icon: Icon, label, color, segment, children, defaultOpen = false }: {
  icon: React.ElementType; label: string; color: string; segment: string;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(defaultOpen || pathname.includes(segment));

  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-xs font-semibold text-gray-500 hover:text-gray-700 uppercase tracking-wider rounded-md hover:bg-gray-50 transition-colors"
      >
        <Icon className={`w-3.5 h-3.5 ${color}`} />
        <span className="flex-1 text-left">{label}</span>
        <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <div className="ml-2 mt-0.5 space-y-0.5 border-l border-gray-100 pl-2">{children}</div>}
    </div>
  );
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const pathname   = usePathname();
  const router     = useRouter();
  const qc         = useQueryClient();
  const { user, clearAuth } = useAuthStore();
  const isAdmin = user?.role === 'admin';

  const handleLogout = async () => {
    try { await authApi.logout(); } catch (_) {}
    qc.clear();
    clearAuth();
    toast.success('Déconnexion réussie');
    router.push('/login');
  };

  const sources       = user?.acquisition_sources ?? [];
  const showInstagram = isAdmin || sources.length === 0 || sources.includes('instagram');
  const showFacebook  = isAdmin || sources.length === 0 || sources.includes('facebook');
  const showColdCall  = isAdmin || sources.length === 0 || sources.includes('cold_call');
  const showQualiopi  = isAdmin || sources.includes('qualiopi');

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo */}
      <div className="flex items-center gap-3 px-4 py-5 border-b border-gray-100">
        <div className="w-9 h-9 bg-primary-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Zap className="w-5 h-5 text-white" />
        </div>
        <div>
          <p className="font-bold text-gray-900 text-sm leading-tight">Payment Flow</p>
          <p className="text-xs text-gray-500">CRM Platform</p>
        </div>
        <button onClick={onClose} className="ml-auto lg:hidden p-1 hover:bg-gray-100 rounded-md">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">

        {/* Dashboard */}
        <NavLink href="/dashboard" icon={LayoutDashboard} label="Dashboard" onClick={onClose} />

        {/* ── Pôle Instagram ── */}
        {showInstagram && (
          <PoleSection icon={Instagram} label="Instagram" color="text-pink-500" segment="instagram">
            <NavLink href="/leads/instagram" icon={Users} label="Leads" onClick={onClose} />
            <NavLink href="/pipeline/instagram" icon={Kanban} label="Pipeline" onClick={onClose} />
          </PoleSection>
        )}

        {/* ── Pôle Facebook ── */}
        {showFacebook && (
          <PoleSection icon={Facebook} label="Facebook" color="text-blue-600" segment="facebook">
            <NavLink href="/leads/facebook" icon={Users} label="Leads" onClick={onClose} />
            <NavLink href="/pipeline/facebook" icon={Kanban} label="Pipeline" onClick={onClose} />
          </PoleSection>
        )}

        {/* ── Pôle Cold Call ── */}
        {showColdCall && (
          <PoleSection icon={Phone} label="Cold Call" color="text-blue-500" segment="cold-call">
            <NavLink href="/leads/cold-call" icon={Users} label="Leads" onClick={onClose} />
            <NavLink href="/pipeline/cold-call" icon={Kanban} label="Pipeline" onClick={onClose} />
          </PoleSection>
        )}

        {/* ── Pôle Qualiopi ── */}
        {showQualiopi && (
          <PoleSection icon={Award} label="Qualiopi" color="text-teal-500" segment="qualiopi">
            <NavLink href="/leads/qualiopi" icon={Users} label="Leads" onClick={onClose} />
            <NavLink href="/pipeline/qualiopi" icon={Kanban} label="Pipeline" onClick={onClose} />
          </PoleSection>
        )}

        {/* Séparateur */}
        <div className="pt-1 pb-0.5">
          <div className="border-t border-gray-100" />
        </div>

        {/* Global (admin) */}
        {isAdmin && (
          <>
            <NavLink href="/leads" icon={Users} label="Tous les leads" onClick={onClose} exact />
            <NavLink href="/pipeline" icon={Kanban} label="Pipeline global" onClick={onClose} exact />
          </>
        )}

        <NavLink href="/import" icon={Upload} label="Import CSV" onClick={onClose} />
        <NavLink href="/ressources" icon={BookOpen} label="Ressources" onClick={onClose} />
        {isAdmin && <NavLink href="/team" icon={UsersRound} label="Équipe" onClick={onClose} />}
        {isAdmin && <NavLink href="/admin" icon={BarChart3} label="Admin" onClick={onClose} />}
        <NavLink href="/chat" icon={MessageSquare} label="Messages" onClick={onClose} />
        <NavLink href="/profile" icon={User} label="Mon profil" onClick={onClose} />
      </nav>

      {/* User section */}
      <div className="p-3 border-t border-gray-100">
        <div className="flex items-center gap-3 px-2 py-2 rounded-lg">
          <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold flex-shrink-0">
            {getInitials(user?.first_name ?? '', user?.last_name ?? '')}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">
              {user?.first_name} {user?.last_name}
            </p>
            <p className="text-xs text-gray-500 capitalize">
              {user?.role === 'admin' ? '👑 Administrateur' : 'Setter'}
            </p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="nav-link w-full mt-1 text-red-600 hover:bg-red-50 hover:text-red-700"
        >
          <LogOut className="w-4 h-4" />
          Se déconnecter
        </button>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-200 h-screen sticky top-0 flex-shrink-0">
        <SidebarContent />
      </aside>
      {mobileOpen && (
        <div className="lg:hidden fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/40" onClick={onClose} />
          <aside className="relative w-56 bg-white h-full shadow-xl z-10">
            <SidebarContent />
          </aside>
        </div>
      )}
    </>
  );
}
