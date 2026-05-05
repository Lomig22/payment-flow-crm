'use client';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LayoutDashboard, Users, Kanban, Upload,
  UsersRound, LogOut, Zap, User, X, Menu,
} from 'lucide-react';
import { cn, getInitials } from '@/lib/utils';
import { useAuthStore } from '@/store/authStore';
import { authApi } from '@/lib/api';
import toast from 'react-hot-toast';
import { useState } from 'react';

const NAV_ITEMS = [
  { href: '/dashboard', icon: LayoutDashboard, label: 'Dashboard',   adminOnly: false },
  { href: '/leads',     icon: Users,           label: 'Leads',        adminOnly: false },
  { href: '/pipeline',  icon: Kanban,          label: 'Pipeline',     adminOnly: false },
  { href: '/import',    icon: Upload,          label: 'Import CSV',   adminOnly: true  },
  { href: '/team',      icon: UsersRound,      label: 'Équipe',       adminOnly: true  },
  { href: '/profile',   icon: User,            label: 'Mon profil',   adminOnly: false },
];

interface SidebarProps {
  mobileOpen: boolean;
  onClose: () => void;
}

export default function Sidebar({ mobileOpen, onClose }: SidebarProps) {
  const pathname   = usePathname();
  const router     = useRouter();
  const { user, clearAuth } = useAuthStore();

  const handleLogout = async () => {
    try { await authApi.logout(); } catch (_) {}
    clearAuth();
    toast.success('Déconnexion réussie');
    router.push('/login');
  };

  const navItems = NAV_ITEMS.filter(
    (item) => !item.adminOnly || user?.role === 'admin'
  );

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
        {/* Mobile close */}
        <button onClick={onClose} className="ml-auto lg:hidden p-1 hover:bg-gray-100 rounded-md">
          <X className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ href, icon: Icon, label }) => {
          const isActive = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
          return (
            <Link
              key={href}
              href={href}
              onClick={onClose}
              className={cn('nav-link', isActive && 'active')}
            >
              <Icon className="w-4 h-4 flex-shrink-0" />
              {label}
              {isActive && (
                <span className="ml-auto w-1.5 h-1.5 rounded-full bg-primary-600" />
              )}
            </Link>
          );
        })}
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
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-white border-r border-gray-200 h-screen sticky top-0 flex-shrink-0">
        <SidebarContent />
      </aside>

      {/* Mobile overlay */}
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
