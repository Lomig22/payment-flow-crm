'use client';
import { useState } from 'react';
import { UserPlus, Upload } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '@/lib/api';
import Modal from '@/components/ui/Modal';

// Import des abonnés depuis l'export officiel Instagram (« Télécharger vos informations »,
// format JSON, fichier followers_1.json) : les abonnés récents passent en « Follow back ».

interface Follower { username: string; followed_at: string | null }

// Formats d'export rencontrés : tableau d'entrées, ou { relationships_followers: [...] } ;
// pseudo dans string_list_data.value, sinon title, sinon le lien (…/_u/pseudo ou …/pseudo)
function parseExport(json: unknown): Follower[] {
  const list: any[] = Array.isArray(json) ? json : ((json as any)?.relationships_followers ?? []);
  return list.map((entry) => {
    const d = entry?.string_list_data?.[0] ?? {};
    const fromHref = typeof d.href === 'string' ? d.href.replace(/\/_u\//, '/').match(/instagram\.com\/([A-Za-z0-9._]{1,30})/)?.[1] : null;
    const username = String(d.value || entry?.title || fromHref || '').trim().replace(/^@/, '');
    return { username, followed_at: d.timestamp ? new Date(d.timestamp * 1000).toISOString() : null };
  }).filter((f) => f.username);
}

const PERIODS = [
  { days: 7, label: '7 derniers jours' },
  { days: 30, label: '30 derniers jours' },
  { days: 90, label: '3 derniers mois' },
  { days: 0, label: 'Tous les abonnés' },
];

export default function FollowersImport({ onDone }: { onDone: () => void }) {
  const [open, setOpen]         = useState(false);
  const [followers, setFollowers] = useState<Follower[] | null>(null);
  const [days, setDays]         = useState(30);
  const [busy, setBusy]         = useState(false);

  const readFile = async (file?: File) => {
    if (!file) return;
    try {
      const list = parseExport(JSON.parse(await file.text()));
      if (!list.length) throw new Error('aucun abonné trouvé');
      setFollowers(list);
    } catch (e: any) {
      setFollowers(null);
      toast.error(`Fichier illisible (${e.message}). Choisissez followers_1.json, export au format JSON.`);
    }
  };

  const recent = followers?.filter((f) => !days || !f.followed_at || Date.parse(f.followed_at) >= Date.now() - days * 86_400_000).length ?? 0;

  const submit = async () => {
    if (!followers) return;
    setBusy(true);
    try {
      const { data } = await api.post('/instagram/followers-import', {
        account_username: 'lomig_guegueniat',
        followers,
        since: days ? new Date(Date.now() - days * 86_400_000).toISOString() : null,
      });
      toast.success(`${data.created} nouveau(x) lead(s), ${data.promoted} passé(s) en Follow back` +
        (data.in_conversation ? `, ${data.in_conversation} déjà en conversation (inchangés)` : ''));
      setOpen(false); setFollowers(null);
      onDone();
    } catch (e: any) {
      toast.error(e.response?.data?.message ?? 'Import impossible');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button onClick={() => setOpen(true)} className="btn-secondary btn-sm">
        <UserPlus className="w-3.5 h-3.5" /> Importer mes abonnés
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="Importer les abonnés de @lomig_guegueniat" size="lg">
        <div className="space-y-4 text-sm text-gray-700">
          <div className="bg-gray-50 rounded-lg p-3 space-y-1 text-xs">
            <p className="font-semibold text-gray-900">Récupérer le fichier (Instagram ne donne pas la liste par API)</p>
            <ol className="list-decimal pl-4 space-y-0.5">
              <li>App Instagram → Profil → ☰ → Espace Comptes → Vos informations et autorisations → <b>Télécharger vos informations</b>.</li>
              <li>Choisir @lomig_guegueniat → <b>Certaines de vos informations</b> → cocher uniquement <b>Abonnés et abonnements</b>.</li>
              <li>Période : la plus récente qui couvre vos nouveaux abonnés ; <b>Format : JSON</b> → Créer les fichiers.</li>
              <li>Quand l&apos;e-mail arrive (quelques minutes), télécharger le .zip, l&apos;ouvrir et choisir <b>followers_1.json</b> ci-dessous.</li>
            </ol>
          </div>

          <label className="flex items-center gap-3 p-3 border-2 border-dashed border-gray-200 rounded-lg cursor-pointer hover:border-primary-300">
            <Upload className="w-5 h-5 text-gray-400" />
            <span>{followers ? `${followers.length} abonnés lus` : 'Choisir followers_1.json'}</span>
            <input type="file" accept=".json,application/json" className="hidden" onChange={(e) => readFile(e.target.files?.[0])} />
          </label>

          <div className="flex items-center gap-2">
            <span>Importer les abonnés des</span>
            <select value={days} onChange={(e) => setDays(+e.target.value)} className="select w-auto text-sm">
              {PERIODS.map((p) => <option key={p.days} value={p.days}>{p.label}</option>)}
            </select>
            {followers && <span className="text-xs text-gray-500">→ {recent} abonné(s)</span>}
          </div>

          <p className="text-xs text-gray-500">
            Nouveaux abonnés → créés en <b>Follow back</b> (DM à envoyer depuis @lomig_guegueniat). Leads déjà connus au stade
            À follow / Follow envoyé / Lead → passent en Follow back. Ceux déjà en conversation ne sont pas modifiés.
          </p>

          <div className="flex justify-end gap-2">
            <button onClick={() => setOpen(false)} className="btn-secondary btn-sm">Annuler</button>
            <button onClick={submit} disabled={!followers || !recent || busy} className="btn-primary btn-sm">
              {busy ? 'Import…' : `Importer ${recent} abonné(s)`}
            </button>
          </div>
        </div>
      </Modal>
    </>
  );
}
