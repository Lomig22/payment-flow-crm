'use client';
import { Menu, Bell, Search } from 'lucide-react';
import { useAuthStore } from '@/store/authStore';
import { getInitials } from '@/lib/utils';

interface HeaderProps {
  title:        string;
  onMenuClick:  () => void;
}

export default function Header({ title, onMenuClick }: HeaderProps) {
  const user = useAuthStore((s) => s.user);

  return (
    <header className="bg-white border-b border-gray-200 px-4 lg:px-6 py-3 flex items-center gap-4 sticky top-0 z-30">
      {/* Mobile menu toggle */}
      <button onClick={onMenuClick} className="lg:hidden p-2 hover:bg-gray-100 rounded-lg">
        <Menu className="w-5 h-5 text-gray-600" />
      </button>

      {/* Page title */}
      <h1 className="text-lg font-semibold text-gray-900 flex-shrink-0">{title}</h1>

      {/* Search */}
      <div className="flex-1 max-w-sm hidden sm:block">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Rechercher un lead…"
            className="input pl-9 py-1.5 text-sm bg-gray-50"
          />
        </div>
      </div>

      <div className="flex items-center gap-3 ml-auto">
        {/* Notifications */}
        <button className="relative p-2 hover:bg-gray-100 rounded-lg">
          <Bell className="w-5 h-5 text-gray-500" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-primary-600 rounded-full" />
        </button>

        {/* Avatar */}
        <div className="w-8 h-8 rounded-full bg-primary-100 text-primary-700 flex items-center justify-center text-xs font-bold">
          {getInitials(user?.first_name ?? '', user?.last_name ?? '')}
        </div>
      </div>
    </header>
  );
}
