'use client';
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Send, AlertTriangle, Copy, Moon, Settings2 } from 'lucide-react';
import toast from 'react-hot-toast';
import { leadsApi, socialAccountsApi, type SocialAccount, type InstagramAccountActivity, type InstagramSendStats, type IgLimits } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import Modal from '@/components/ui/Modal';
import { useDmAccountStore } from '@/store/dmAccountStore';
import { buildM1, M1_VARIANTS } from '@/lib/dmScript';
import {
  FOLLOW_DAILY_LIMIT, DM_DAILY_LIMIT, DM_HOURLY_LIMIT, DM_MIN_INTERVAL_SEC, DM_OUTREACH_STATUSES, igProfileUrl,
} from '@/lib/instagram';
import { igDmUrl } from '@/lib/utils';
import type { Lead } from '@/types';

const STEP_LABELS: Record<string, string> = { m1: 'M1 envoyé', r1: 'R1', r2: 'R2' };
// Étapes où le prochain message est le premier DM (script M1) : DM à froid, ou follow back.
const M1_STEPS = new Set<string>(['lead', 'followed_back']);

export const accountHandle = (a: Pick<SocialAccount, 'username' | 'account_name'>) =>
  `@${(a.username || a.account_name).trim().replace(/^@/, '')}`;

export function useInstagramAccounts() {
  return useQuery({
    queryKey: ['social-accounts', 'instagram'],
    queryFn:  () => socialAccountsApi.getAll('instagram').then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

// Copie synchrone (textarea + execCommand) : elle doit aboutir AVANT que le lien
// target=_blank n'ouvre l'onglet des DM. navigator.clipboard.writeText est
// asynchrone et Chrome la rejette (« Document is not focused ») dès que le
// nouvel onglet a pris le focus. Renvoie false si le navigateur refuse.
function copyTextSync(text: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.setAttribute('readonly', '');
  ta.style.position = 'fixed';
  ta.style.top = '0';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  ta.setSelectionRange(0, text.length);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

function useDmStats() {
  return useQuery({
    queryKey: ['instagram-dm-stats'],
    queryFn:  () => leadsApi.dmStats().then((r) => r.data),
    refetchInterval: 60_000,
  });
}

const frDate = (iso: string) => new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' });
const isPaused = (a?: { paused_until?: string | null }) =>
  !!a?.paused_until && new Date(a.paused_until).getTime() > Date.now();
// Limites en vigueur (réglées par un admin, renvoyées par dm-stats) ; 0 = pas de limite
const limitsOf = (s?: InstagramSendStats): IgLimits => s?.limits ?? {
  dm_per_day: DM_DAILY_LIMIT, follows_per_day: FOLLOW_DAILY_LIMIT, dm_per_hour: DM_HOURLY_LIMIT,
  dm_interval_sec: DM_MIN_INTERVAL_SEC, suspended_until: null, suspended: false,
};
const secondsToWait = (a: InstagramAccountActivity | undefined, lim: IgLimits) =>
  a?.last_dm_at && lim.dm_interval_sec ? Math.max(0, lim.dm_interval_sec - Math.floor((Date.now() - new Date(a.last_dm_at).getTime()) / 1000)) : 0;

// Pourquoi ce compte ne peut pas envoyer de DM de prospection maintenant (null = il peut).
function dmBlockReason(accountId: string | null, a: InstagramAccountActivity | undefined, lim: IgLimits): string | null {
  if (!accountId) return 'Sélectionne d’abord le compte depuis lequel tu envoies le DM';
  if (isPaused(a)) return `Compte au repos jusqu’au ${frDate(a!.paused_until!)} — choisis un autre compte`;
  const wait = secondsToWait(a, lim);
  if (wait > 0) return `Trop rapide : attends encore ${wait} s avant le prochain DM`;
  if (lim.dm_per_hour > 0 && (a?.dm_hour ?? 0) >= lim.dm_per_hour) return `Limite atteinte : ${lim.dm_per_hour} DM par heure sur ce compte. Fais une pause.`;
  if (lim.dm_per_day > 0 && (a?.dm_today ?? 0) >= lim.dm_per_day) return `Limite atteinte : ${lim.dm_per_day} DM aujourd’hui sur ce compte`;
  return null;
}

// Message M1 du lead pour le compte sélectionné : la formulation tourne à chaque
// envoi (rang = DM du jour, décalé par compte) et évite les dernières utilisées.
function useM1Builder() {
  const accountId = useDmAccountStore((s) => s.accountId);
  const { data: stats } = useDmStats();
  const activity = accountId ? stats?.accounts?.[accountId] : undefined;
  const offset = accountId ? Array.from(accountId).reduce((h, c) => (h * 31 + c.charCodeAt(0)) % M1_VARIANTS, 7) : 0;
  return (lead: Lead) => buildM1(lead, { seq: (activity?.dm_today ?? 0) + offset, avoid: activity?.recent_variants ?? [] });
}

// Clic sur le @ d'un lead : le lien (target=_blank) ouvre les DM, et en
// parallèle le serveur avance le lead d'une étape et journalise le compte.
// Renvoie false si l'envoi est refusé (sécurité de cadence) : le lien ne doit pas s'ouvrir.
export function useDmClick() {
  const qc = useQueryClient();
  const accountId = useDmAccountStore((s) => s.accountId);
  const { data: stats } = useDmStats();
  const m1For = useM1Builder();

  const mutation = useMutation({
    mutationFn: ({ leadId, variant }: { leadId: string; variant?: string }) =>
      leadsApi.dmClick(leadId, accountId, variant).then((r) => r.data),
    retry: (count, err: any) => (err?.response?.status ?? 500) >= 500 && count < 2,
    networkMode: 'always',
    onSuccess: ({ lead, advanced }) => {
      if (advanced) toast.success(`Lead passé en « ${STEP_LABELS[lead.status] ?? lead.status} »`);
    },
    onError: (err: any) =>
      toast.error(err?.response?.data?.message ?? 'DM ouvert, mais le statut du lead n’a pas pu être mis à jour'),
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['instagram-dm-stats'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('leads-'),
      });
    },
  });

  return (lead: Lead): boolean => {
    const outreach = DM_OUTREACH_STATUSES.includes(lead.status);
    if (outreach) {
      const reason = dmBlockReason(accountId, accountId ? stats?.accounts?.[accountId] : undefined, limitsOf(stats));
      if (reason) { toast.error(reason, { duration: 5000 }); return false; }
    }

    // Premier contact : le script M1 personnalisé est copié pour être collé dans
    // le DM (Instagram ne permet pas de pré-remplir un message via lien).
    let variant: string | undefined;
    if (M1_STEPS.has(lead.status)) {
      const m1 = m1For(lead);
      variant = m1.variant;
      if (copyTextSync(m1.text)) {
        toast.success('Message M1 copié — colle-le dans le DM', { duration: 4000 });
      } else {
        navigator.clipboard?.writeText(m1.text)
          .then(() => toast.success('Message M1 copié — colle-le dans le DM', { duration: 4000 }))
          .catch(() => toast.error('Impossible de copier le message'));
      }
    }

    // Compteurs locaux mis à jour tout de suite : un 2e clic immédiat est bloqué
    // sans attendre la réponse du serveur.
    if (outreach && accountId) {
      qc.setQueryData<InstagramSendStats>(['instagram-dm-stats'], (old) => {
        if (!old) return old;
        const a = old.accounts?.[accountId] ?? { dm_today: 0, dm_hour: 0, last_dm_at: null, follows_today: 0, recent_variants: [], paused_until: null, pause_reason: null };
        return {
          ...old,
          today: { ...old.today, [accountId]: a.dm_today + 1 },
          accounts: { ...old.accounts, [accountId]: {
            ...a, dm_today: a.dm_today + 1, dm_hour: a.dm_hour + 1, last_dm_at: new Date().toISOString(),
            recent_variants: variant ? [variant, ...a.recent_variants].slice(0, 8) : a.recent_variants,
          } },
        };
      });
    }
    mutation.mutate({ leadId: lead.id, variant });
    return true;
  };
}

// Piste « follow d'abord » : clic sur le @ d'un lead « À follow » → le profil
// s'ouvre (follow fait à la main) et le CRM compte le follow + passe le lead en
// « Follow envoyé ». Bloqué côté client ET serveur au plafond quotidien réglé par un admin.
export function useFollowClick() {
  const qc = useQueryClient();
  const accountId = useDmAccountStore((s) => s.accountId);
  const { data: stats } = useDmStats();

  const mutation = useMutation({
    mutationFn: (leadId: string) => leadsApi.followClick(leadId, accountId).then((r) => r.data),
    retry: (count, err: any) => err?.response?.status >= 500 && count < 2,
    networkMode: 'always',
    onSuccess: ({ counted, today }) => {
      const max = limitsOf(stats).follows_per_day;
      if (counted) toast.success(`Follow compté (${today}${max ? `/${max}` : ''} aujourd’hui) — lead en « Follow envoyé »`);
      qc.invalidateQueries({ queryKey: ['instagram-dm-stats'] });
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('leads-'),
      });
    },
    onError: (err: any) => toast.error(err?.response?.data?.message ?? 'Le follow n’a pas pu être enregistré'),
  });

  // Renvoie false si le follow est refusé (pas de compte / quota) : le lien ne doit pas s'ouvrir.
  return (lead: Lead): boolean => {
    if (!accountId) {
      toast.error('Sélectionne d’abord le compte depuis lequel tu follow');
      return false;
    }
    const activity = stats?.accounts?.[accountId];
    if (isPaused(activity)) {
      toast.error(`Compte au repos jusqu’au ${frDate(activity!.paused_until!)} — choisis un autre compte`);
      return false;
    }
    const maxFollows = limitsOf(stats).follows_per_day;
    if (maxFollows > 0 && (stats?.follows?.[accountId] ?? 0) >= maxFollows) {
      toast.error(`Quota atteint : ${maxFollows} follows aujourd’hui sur ce compte`);
      return false;
    }
    mutation.mutate(lead.id);
    return true;
  };
}

// Lien du @ d'un lead Instagram, selon son étape :
//   À follow      → profil (+ compte le follow)
//   Follow envoyé → profil (vérifier le follow back ; rien n'est modifié)
//   autres        → DM (+ copie du script / avancement du funnel)
export function useIgHandle() {
  const dmClick     = useDmClick();
  const followClick = useFollowClick();

  return (lead: Lead) => {
    const username = lead.instagram_username ?? '';
    if (lead.status === 'to_follow') {
      return {
        href:  igProfileUrl(username),
        title: 'Ouvrir le profil pour follow',
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); if (!followClick(lead)) e.preventDefault(); },
      };
    }
    if (lead.status === 'followed') {
      return {
        href:  igProfileUrl(username),
        title: 'Ouvrir le profil — vérifier le follow back',
        onClick: (e: React.MouseEvent) => { e.stopPropagation(); },
      };
    }
    return {
      href:  igDmUrl(username),
      title: 'Ouvrir les DM Instagram',
      onClick: (e: React.MouseEvent) => { e.stopPropagation(); if (!dmClick(lead)) e.preventDefault(); },
    };
  };
}

export function DmAccountBar() {
  const qc = useQueryClient();
  const { accountId, setAccountId } = useDmAccountStore();
  const { data: accounts } = useInstagramAccounts();
  const { data: dmStats } = useDmStats();

  // Compte mémorisé supprimé (ou non visible pour ce setter) → on le retire.
  useEffect(() => {
    if (accounts && accountId && !accounts.some((a) => a.id === accountId)) setAccountId(null);
  }, [accounts, accountId, setAccountId]);

  const isAdmin  = useAuthStore((s) => s.user?.role === 'admin');
  const lim      = limitsOf(dmStats);
  const selected = accounts?.find((a) => a.id === accountId);
  const activity = (id: string) => dmStats?.accounts?.[id];
  const act      = selected ? activity(selected.id) : undefined;
  const paused   = isPaused(act);

  // Compte à rebours du délai minimum entre deux DM
  const [, tick] = useState(0);
  const wait = secondsToWait(act, lim);
  const waiting = wait > 0;
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [waiting, act?.last_dm_at]);

  const pause = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) => socialAccountsApi.pause(id, days),
    onSuccess: (_, { days }) => {
      toast.success(days > 0 ? `Compte mis au repos ${days} jour${days > 1 ? 's' : ''}` : 'Compte réactivé');
      qc.invalidateQueries({ queryKey: ['instagram-dm-stats'] });
      qc.invalidateQueries({ queryKey: ['social-accounts'] });
    },
    onError: () => toast.error('Impossible de modifier le repos du compte'),
  });

  // max = 0 : pas de limite (compteur seul)
  const chip = (label: string, value: number, max: number) => (
    <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap
      ${max && value >= max ? 'bg-red-100 text-red-700' : max && value >= max * 0.8 ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-600'}`}>
      {max ? `${value}/${max}` : value} {label}
    </span>
  );
  const quota = (v: number, max: number) => (max ? `${v}/${max}` : `${v}`);

  return (
    <div className={`card px-4 py-3 border-l-4 space-y-2
      ${paused ? 'border-l-red-500 bg-red-50/40' : selected ? 'border-l-pink-500' : 'border-l-amber-400 bg-amber-50/40'}`}>
      <div className="flex flex-wrap items-center gap-3">
        <Send className="w-4 h-4 text-pink-500 flex-shrink-0" />
        <label className="text-sm text-gray-600">Envoyer depuis :</label>
        {isAdmin && <LimitsButton />}
        <select
          value={accountId ?? ''}
          onChange={(e) => setAccountId(e.target.value || null)}
          className="select w-auto text-sm"
        >
          <option value="">— Choisir un compte —</option>
          {(accounts ?? []).map((a) => {
            const x = activity(a.id);
            return (
              <option key={a.id} value={a.id}>
                {accountHandle(a)} · {isPaused(x)
                  ? `au repos jusqu’au ${frDate(x!.paused_until!)}`
                  : `${quota(x?.dm_today ?? 0, lim.dm_per_day)} DM · ${quota(x?.follows_today ?? 0, lim.follows_per_day)} follows`}
              </option>
            );
          })}
        </select>

        {selected && !paused && (
          <>
            {chip('DM / jour', act?.dm_today ?? 0, lim.dm_per_day)}
            {lim.dm_per_hour > 0 && chip('DM / heure', act?.dm_hour ?? 0, lim.dm_per_hour)}
            {chip('follows', act?.follows_today ?? 0, lim.follows_per_day)}
            {waiting && (
              <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 whitespace-nowrap">
                prochain DM dans {wait} s
              </span>
            )}
          </>
        )}

        {selected && (
          paused ? (
            <button
              type="button"
              disabled={pause.isPending}
              onClick={() => { if (confirm(`Réactiver ${accountHandle(selected)} maintenant ?`)) pause.mutate({ id: selected.id, days: 0 }); }}
              className="ml-auto text-xs text-gray-500 hover:text-gray-800 underline"
            >
              Réactiver le compte
            </button>
          ) : (
            <select
              value=""
              disabled={pause.isPending}
              onChange={(e) => { const d = Number(e.target.value); if (d > 0) pause.mutate({ id: selected.id, days: d }); }}
              className="ml-auto text-xs border border-gray-200 rounded-md px-1.5 py-1 bg-white text-gray-500 cursor-pointer"
              title="Compte restreint ou fatigué : le mettre au repos bloque follows et DM"
            >
              <option value="">Mettre au repos…</option>
              <option value="1">24 heures</option>
              <option value="3">3 jours</option>
              <option value="7">7 jours</option>
              <option value="14">14 jours</option>
            </select>
          )
        )}
      </div>

      {paused ? (
        <p className="text-xs text-red-700 flex items-start gap-1.5">
          <Moon className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <span>
            <strong>{accountHandle(selected!)} est au repos jusqu’au {frDate(act!.paused_until!)}</strong> : ni follow ni DM de prospection.
            {act?.pause_reason ? ` ${act.pause_reason}.` : ''} Choisis un autre compte.
          </span>
        </p>
      ) : selected ? (
        <p className="text-xs text-gray-500">
          Vérifie qu’Instagram est bien connecté sur <strong className="text-gray-700">{accountHandle(selected)}</strong>.
          {lim.suspended
            ? <><strong className="text-amber-700">Limites suspendues jusqu’à {new Date(lim.suspended_until!).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', hour: '2-digit', minute: '2-digit' })}.</strong> </>
            : <>Cadence : {lim.dm_interval_sec > 0 ? `1 DM toutes les ${lim.dm_interval_sec} s, ` : ''}{lim.dm_per_hour > 0 ? `${lim.dm_per_hour}/heure, ` : ''}{lim.dm_per_day > 0 ? `${lim.dm_per_day} DM/jour` : 'DM sans limite'} — </>}
          le message copié change à chaque envoi.
        </p>
      ) : (
        <p className="text-xs text-amber-700 flex items-center gap-1">
          <AlertTriangle className="w-3.5 h-3.5" />
          Sélectionne le compte depuis lequel tu follow et envoies tes DM.
        </p>
      )}
      {accounts && accounts.length === 0 && (
        <p className="text-xs text-gray-400">Aucun compte Instagram enregistré (page Profil → comptes sociaux).</p>
      )}
    </div>
  );
}

// Bouton de secours : copie le script M1 sans ouvrir les DM ni toucher au statut.
// Même formulation que celle qui sera copiée au clic sur le @.
export function CopyM1Button({ lead }: { lead: Lead }) {
  const m1For = useM1Builder();
  if (!M1_STEPS.has(lead.status)) return null;
  const copy = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    const message = m1For(lead).text;
    if (copyTextSync(message)) { toast.success('Message M1 copié'); return; }
    navigator.clipboard?.writeText(message)
      .then(() => toast.success('Message M1 copié'))
      .catch(() => toast.error('Impossible de copier le message'));
  };
  return (
    <button
      type="button"
      onClick={copy}
      onMouseDown={(e) => e.stopPropagation()}
      onTouchStart={(e) => e.stopPropagation()}
      title={m1For(lead).text}
      className="p-0.5 rounded text-gray-300 hover:text-pink-600 hover:bg-pink-50 flex-shrink-0"
    >
      <Copy className="w-3 h-3" />
    </button>
  );
}

export function DmAccountTag({ accountId }: { accountId?: string | null }) {
  const { data: accounts } = useInstagramAccounts();
  const acc = accountId ? accounts?.find((a) => a.id === accountId) : undefined;
  if (!acc) return null;
  return <span className="text-[10px] text-pink-600/80">via {accountHandle(acc)}</span>;
}

// Vérification matinale des follow backs (VA) sur les leads « Follow envoyé » :
//   Oui → le lead passe en « Follow back » (followed_back_at posé par la route PUT)
//   Non → on horodate seulement la vérification (follow_back_checked_at), le lead
//         reste en « Follow envoyé » et la carte affiche « vérifié le … ».
export function useFollowBackAnswer() {
  const qc = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ lead, yes }: { lead: Lead; yes: boolean }) =>
      leadsApi.update(lead.id, yes
        ? ({ status: 'followed_back' } as Partial<Lead>)
        : ({ follow_back_checked_at: new Date().toISOString() } as Partial<Lead>),
      ).then((r) => r.data),
    retry: 2,
    networkMode: 'always',
    onSuccess: (_, { lead, yes }) => {
      toast.success(yes
        ? `@${lead.instagram_username} → Follow back ✓ (prêt pour le DM)`
        : `@${lead.instagram_username} : pas de follow back, vérification notée`);
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({
        predicate: (q) => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('leads-'),
      });
    },
    onError: () => toast.error('La réponse n’a pas pu être enregistrée'),
  });
  return mutation;
}

const isToday = (iso?: string | null) =>
  !!iso && new Date(iso).toDateString() === new Date().toDateString();

// Boutons « Follow back ? Oui / Non » — liste Instagram (onglet Follow envoyé) et
// cartes du pipeline. stopPropagation : ni drag, ni ouverture de la fiche.
export function FollowBackButtons({ lead, compact }: { lead: Lead; compact?: boolean }) {
  const answer = useFollowBackAnswer();
  if (lead.status !== 'followed') return null;
  const stop = (e: React.SyntheticEvent) => { e.stopPropagation(); e.preventDefault(); };
  const checkedToday = isToday(lead.follow_back_checked_at);
  const btn = 'px-2 py-0.5 rounded-md text-[11px] font-semibold border transition-colors disabled:opacity-50';
  return (
    <div className={`flex items-center gap-1.5 ${compact ? 'mt-1.5' : ''}`}
      onMouseDown={stop} onTouchStart={stop} onClick={(e) => e.stopPropagation()}>
      {!compact && <span className="text-[11px] text-gray-500">Follow back ?</span>}
      {compact && <span className="text-[10px] text-gray-400">Follow back ?</span>}
      <button type="button" disabled={answer.isPending}
        onClick={(e) => { stop(e); answer.mutate({ lead, yes: true }); }}
        className={`${btn} border-teal-300 text-teal-700 bg-teal-50 hover:bg-teal-100`}>
        Oui
      </button>
      <button type="button" disabled={answer.isPending}
        onClick={(e) => { stop(e); answer.mutate({ lead, yes: false }); }}
        className={`${btn} ${checkedToday
          ? 'border-gray-200 text-gray-400 bg-gray-50'
          : 'border-gray-300 text-gray-600 bg-white hover:bg-gray-100'}`}>
        Non
      </button>
      {lead.follow_back_checked_at && (
        <span className="text-[10px] text-gray-400 whitespace-nowrap" title="Dernière vérification sans follow back">
          {checkedToday ? 'vérifié aujourd’hui' : `vérifié le ${new Date(lead.follow_back_checked_at).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })}`}
        </span>
      )}
    </div>
  );
}

// Réglage des limites d'envoi (admins) : valeurs par compte et par jour, suspension jusqu'à minuit
function LimitsButton() {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const { data } = useQuery({ queryKey: ['instagram-limits'], queryFn: () => leadsApi.limits().then((r) => r.data), enabled: open });
  useEffect(() => {
    if (data) setForm({ dm_per_day: String(data.dm_per_day), follows_per_day: String(data.follows_per_day), dm_per_hour: String(data.dm_per_hour), dm_interval_sec: String(data.dm_interval_sec) });
  }, [data]);

  const save = useMutation({
    mutationFn: (payload: Parameters<typeof leadsApi.saveLimits>[0]) => leadsApi.saveLimits(payload).then((r) => r.data),
    onSuccess: (d, payload) => {
      toast.success(payload.suspend === 'today' ? 'Limites suspendues jusqu’à minuit' : payload.suspend === 'off' ? 'Limites réactivées' : 'Limites enregistrées');
      qc.setQueryData(['instagram-limits'], d);
      qc.invalidateQueries({ queryKey: ['instagram-dm-stats'] });
      if (!payload.suspend) setOpen(false);
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Enregistrement impossible'),
  });

  const fields: { key: string; label: string; hint: string }[] = [
    { key: 'dm_per_day',      label: 'DM par jour et par compte',      hint: '0 = pas de limite' },
    { key: 'follows_per_day', label: 'Follows par jour et par compte', hint: '0 = pas de limite' },
    { key: 'dm_per_hour',     label: 'DM par heure et par compte',     hint: '0 = pas de limite' },
    { key: 'dm_interval_sec', label: 'Délai minimum entre deux DM (secondes)', hint: '0 = aucun délai' },
  ];

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-gray-500 hover:text-gray-800 flex items-center gap-1" title="Régler les limites d’envoi">
        <Settings2 className="w-3.5 h-3.5" /> Limites
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Limites d’envoi Instagram" size="md">
        {!data ? <p className="text-sm text-gray-500">Chargement…</p> : (
          <div className="space-y-4">
            <div className={`rounded-lg p-3 text-sm ${data.suspended ? 'bg-amber-50 text-amber-800' : 'bg-gray-50 text-gray-700'}`}>
              {data.suspended
                ? <>Limites <strong>suspendues</strong> jusqu’à {new Date(data.suspended_until!).toLocaleString('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', hour: '2-digit', minute: '2-digit' })}.</>
                : <>Les limites s’appliquent à chaque compte d’envoi.</>}
              <div className="mt-2">
                {data.suspended
                  ? <button onClick={() => save.mutate({ suspend: 'off' })} disabled={save.isPending} className="btn-secondary btn-sm">Réactiver les limites</button>
                  : <button onClick={() => save.mutate({ suspend: 'today' })} disabled={save.isPending} className="btn-secondary btn-sm">Suspendre jusqu’à ce soir minuit</button>}
              </div>
            </div>
            {fields.map((f) => (
              <div key={f.key}>
                <label className="label">{f.label}</label>
                <input type="number" min={0} value={form[f.key] ?? ''} onChange={(e) => setForm((x) => ({ ...x, [f.key]: e.target.value }))} className="input" />
                <p className="text-[11px] text-gray-400 mt-1">{f.hint}</p>
              </div>
            ))}
            <p className="text-xs text-amber-700 flex items-start gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
              Des envois trop rapides ou trop nombreux exposent les comptes à une restriction Instagram (comme le 28/09).
            </p>
            <div className="flex justify-end gap-2">
              <button onClick={() => setOpen(false)} className="btn-secondary btn-sm">Annuler</button>
              <button onClick={() => save.mutate(Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])) as any)}
                disabled={save.isPending} className="btn-primary btn-sm">Enregistrer</button>
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
