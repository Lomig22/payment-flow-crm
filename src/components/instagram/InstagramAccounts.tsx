'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Instagram, Plus } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';

// Comptes Instagram connectés au CRM (compte perso de Lomig, compte agence @paymentflow…) et
// connexion d'un nouveau compte en collant son jeton d'accès (jamais dans une conversation)

interface Account { account_username: string; expires_at: string | null; last_sync_at: string | null; last_sync_error: string | null }
const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris', day: 'numeric', month: 'short' }) : '—');

export default function InstagramAccounts() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState('');
  const { data = [] } = useQuery({ queryKey: ['ig-accounts'], queryFn: () => api.get<Account[]>('/instagram/accounts').then((r) => r.data) });
  const connect = useMutation({
    mutationFn: () => api.post<{ account_username: string }>('/instagram/accounts', { token }),
    onSuccess: (r) => { toast.success(`@${r.data.account_username} connecté`); setToken(''); setOpen(false); qc.invalidateQueries({ queryKey: ['ig-accounts'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Connexion impossible'),
  });
  return (
    <div className="card p-4 space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <Instagram className="w-4 h-4 text-pink-500" />
        <span className="font-semibold text-gray-900">Comptes Instagram</span>
        {data.map((a) => (
          <span key={a.account_username} className="px-2 py-1 rounded-full bg-gray-100 text-gray-700">
            @{a.account_username} <span className="text-xs text-gray-400">· jeton valable jusqu&apos;au {fmt(a.expires_at)}</span>
          </span>
        ))}
        <button className="ml-auto btn-secondary btn-sm" onClick={() => setOpen(!open)}><Plus className="w-3.5 h-3.5" /> Connecter un compte</button>
      </div>
      {open && (
        <div className="flex flex-wrap gap-2 items-center">
          <input type="password" className="input py-1.5 flex-1 min-w-[260px] font-mono text-xs" placeholder="Colle ici le jeton d'accès Instagram du compte"
            value={token} onChange={(e) => setToken(e.target.value)} />
          <button className="btn-primary btn-sm" disabled={connect.isPending || token.trim().length < 50} onClick={() => connect.mutate()}>Connecter</button>
          <p className="w-full text-xs text-gray-500">Le jeton est vérifié auprès d&apos;Instagram puis enregistré pour le compte auquel il appartient. Il est prolongé automatiquement chaque semaine.</p>
        </div>
      )}
    </div>
  );
}
