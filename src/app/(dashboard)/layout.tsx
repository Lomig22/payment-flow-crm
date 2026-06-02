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
  '/chat':      'Messages',
};

const NO_PADDING_PAGES = ['/chat'];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router          = useRouter();
  const pathname        = usePathname();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [mounted, setMounted]       = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (mounted && !isAuthenticated) {
      router.replace('/login');
    }
  }, [mounted, isAuthenticated, router]);

  if (!mounted) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!isAuthenticated) return null;

  const title = PAGE_TITLES[pathname] ??
    (pathname.startsWith('/leads/') ? 'Fiche Lead' : 'Payment Flow CRM');

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />

      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Header title={title} onMenuClick={() => setMobileOpen(true)} />
        <main className={`flex-1 min-h-0 ${
          NO_PADDING_PAGES.some(p => pathname.startsWith(p))
            ? 'overflow-hidden flex flex-col'
            : 'overflow-y-auto p-4 lg:p-6'
        }`}>
          {children}
        </main>
      </div>
    </div>
  );
}
