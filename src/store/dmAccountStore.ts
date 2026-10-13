'use client';
import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';

// Compte Instagram d'envoi des DM choisi dans le CRM (mémorisé par navigateur).
interface DmAccountState {
  accountId:    string | null;
  setAccountId: (id: string | null) => void;
}

export const useDmAccountStore = create<DmAccountState>()(
  persist(
    (set) => ({
      accountId:    null,
      setAccountId: (accountId) => set({ accountId }),
    }),
    { name: 'pf_dm_account', storage: createJSONStorage(() => localStorage) },
  ),
);
