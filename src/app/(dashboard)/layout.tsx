'use client';
import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Sidebar from '@/components/layout/Sidebar';
import Header from '@/components/layout/Header';
import { useAuthStore } from '@/store/authStore';

const PAGE_TITLES: Record<string, string> = {
  '/dashboard': 'Dashboard',
  '/leads':     'Leads',
  '/pipeline':  'Pipeline',
  '/import':    'Import CSV',
  '/team':      'Équipe',
  '/profile':   'Mon profil',
};

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router          = useRouter();
  const pathname        = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    if (!isAuthenticated) {
      router.replace('/login');
    }
  }, [isAuthenticated, router]);

  if (!isAuthenticated) return null;

  const title = PAGE_TITLES[pathname] ??
    (pathname.startsWith('/leads/') ? 'Fiche Lead' : 'Payment Flow CRM');

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title={title} onMenuClick={() => setMobileOpen(true)} />
        <main className="flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
