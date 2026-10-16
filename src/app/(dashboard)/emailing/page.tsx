'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Send, Reply, AlertTriangle, Sparkles, Bot, Power } from 'lucide-react';
import toast from 'react-hot-toast';
import { emailingApi, type EmailSettingsCfg, type EmailSegment, type EmailStepCfg } from '@/lib/api';
import { VARS_HELP, renderVars } from '@/lib/emailVars';

const SEG_LABEL: Record<EmailSegment, string> = { site: 'Avec site internet', no_site: 'Sans site internet' };
import Spinner from '@/components/ui/Spinner';
import StatCard from '@/components/ui/StatCard';

// Pilotage de l'emailing : les mails partent de Hermès (ses boîtes préchauffées), le CRM décide
// qui contacter et quand, et reçoit chaque événement (envoi, réponse, rebond, désinscription).

const STATUS: Record<string, string> = {
  new: 'À contacter', in_sequence: 'En séquence', replied: 'Ont répondu', interested: 'Intéressés', not_interested: 'Pas intéressés',
  bounced: 'Adresse invalide', unsubscribed: 'Désinscrits', dnc: 'Ne pas contacter', completed: 'Séquence terminée',
};
const DAYS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10} %` : '—');

export default function EmailingPage() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ['emailing-stats'], queryFn: () => emailingApi.stats().then((r) => r.data), refetchInterval: 60_000 });
  const [cfg, setCfg] = useState<EmailSettingsCfg | null>(null);
  const [range, setRange] = useState<'7d' | '30d'>('7d');
  const [seg, setSeg] = useState<EmailSegment>('site');
  // Aperçu : un vrai lead du segment, pris au hasard
  const { data: sample, refetch: nextSample } = useQuery({ queryKey: ['email-preview', seg], queryFn: () => emailingApi.preview(seg).then((r) => r.data) });
  useEffect(() => { if (data && !cfg) setCfg(data.settings); }, [data, cfg]);
  const save = useMutation({
    mutationFn: (s: Partial<EmailSettingsCfg>) => emailingApi.settings(s).then((r) => r.data),
    onSuccess: (s) => { setCfg(s); toast.success('Enregistré'); qc.invalidateQueries({ queryKey: ['emailing-stats'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  if (isLoading || !data || !cfg) return <div className="flex justify-center py-20"><Spinner /></div>;
  // Parcours du segment affiché (avant la migration : la séquence unique sert aux deux)
  const seqs = cfg.sequences ?? { site: cfg.steps, no_site: cfg.steps };
  const steps = seqs[seg];
  const setSteps = (list: EmailStepCfg[]) => setCfg({ ...cfg, sequences: { ...seqs, [seg]: list.map((x, i) => ({ ...x, step: i + 1 })) } });
  const setStep = (i: number, patch: Partial<EmailStepCfg>) => setSteps(steps.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const R = data.rates[range];
  const p = (v: number | null) => (v == null ? '—' : `${Math.round(v * 1000) / 10} %`);
  const goalPct = Math.min(100, Math.round((data.today.sent / Math.max(1, cfg.daily_goal)) * 100));

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2"><Mail className="w-6 h-6 text-indigo-500" />Emailing · Pilotage</h1>
          <p className="text-sm text-gray-500 mt-1">Les mails partent de Hermès ; le CRM choisit qui contacter, arrête la séquence à la première réponse et tient les compteurs.</p>
        </div>
        <button onClick={() => save.mutate({ active: !cfg.active })}
          className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold ${cfg.active ? 'bg-emerald-600 text-white' : 'bg-gray-200 text-gray-700'}`}>
          <Power className="w-4 h-4" />{cfg.active ? 'Envois actifs' : 'Envois en pause'}
        </button>
      </div>

      <div className="card p-5">
        <div className="flex items-baseline justify-between"><p className="font-semibold text-gray-900">Aujourd&apos;hui</p><p className="text-sm text-gray-500">{data.today.sent.toLocaleString('fr-FR')} / {cfg.daily_goal.toLocaleString('fr-FR')} mails</p></div>
        <div className="h-3 rounded-full bg-gray-100 mt-2 overflow-hidden"><div className="h-full bg-indigo-500" style={{ width: `${goalPct}%` }} /></div>
      </div>

      <div className="card p-5">
        <div className="flex items-center gap-3 flex-wrap mb-3">
          <p className="font-semibold text-gray-900">Taux clés</p>
          <div className="flex gap-1 ml-auto">
            {(['7d', '30d'] as const).map((r) => <button key={r} onClick={() => setRange(r)} className={`px-3 py-1 rounded-full text-sm ${range === r ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{r === '7d' ? '7 jours' : '30 jours'}</button>)}
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { label: 'Taux d\'ouverture', v: data.rates[range].open_rate, sub: `${data.rates[range].opened} / ${data.rates[range].contacted} leads contactés` },
            { label: 'Taux de réponse', v: data.rates[range].reply_rate, sub: `${data.rates[range].replied} / ${data.rates[range].contacted} leads contactés` },
          ].map((t) => (
            <div key={t.label} className="rounded-lg p-4 bg-indigo-50 border border-indigo-100">
              <p className="text-xs text-gray-500">{t.label}</p>
              <p className="text-3xl font-bold text-gray-900 tabular-nums">{t.v == null ? '—' : `${Math.round(t.v * 1000) / 10} %`}</p>
              <p className="text-xs text-gray-500">{t.sub}</p>
            </div>
          ))}
        </div>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 text-left"><tr><th className="py-1">Segment</th><th>Contactés</th><th>Ouverture</th><th>Réponse</th></tr></thead>
            <tbody>{(['site', 'no_site'] as const).map((sg) => (
              <tr key={sg} className="border-t"><td className="py-1.5">{SEG_LABEL[sg]}</td><td>{R.by_segment[sg].contacted}</td><td>{p(R.by_segment[sg].open_rate)}</td><td className="font-semibold">{p(R.by_segment[sg].reply_rate)}</td></tr>
            ))}</tbody>
          </table>
          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 text-left"><tr><th className="py-1">Mail</th><th>Envoyés</th><th>Ouverture</th><th>Réponse</th></tr></thead>
            <tbody>{R.by_step.length ? R.by_step.map((st) => (
              <tr key={st.step} className="border-t"><td className="py-1.5">{st.step === 1 ? 'Mail 1' : `Relance ${st.step - 1}`}</td><td>{st.contacted}</td><td>{p(st.open_rate)}</td><td className="font-semibold">{p(st.reply_rate)}</td></tr>
            )) : <tr><td colSpan={4} className="py-2 text-gray-400">Aucun envoi sur la période</td></tr>}</tbody>
          </table>
        </div>
        <p className="text-[11px] text-gray-400 mt-2">Ouvertures mesurées par le pixel du CRM : certaines messageries (Apple Mail) chargent les images d&apos;office et gonflent ce taux ; d&apos;autres les bloquent. Le taux de réponse est le chiffre fiable.</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Envoyés (7 j)" value={data.week.sent.toLocaleString('fr-FR')} icon={Send} />
        <StatCard title="Réponses (7 j)" value={`${data.week.replied} · ${pct(data.week.replied, data.week.sent)}`} icon={Reply} />
        <StatCard title="Intéressés (7 j)" value={String(data.week.interested)} icon={Sparkles} />
        <StatCard title="Rebonds (7 j)" value={`${data.week.bounced} · ${pct(data.week.bounced, data.week.sent)}`} icon={AlertTriangle} />
      </div>

      <div className="card p-5">
        <p className="font-semibold text-gray-900 mb-3">Leads par statut</p>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
          {Object.entries(STATUS).map(([k, label]) => (
            <a key={k} href={`/emailing/leads?status=${k}`} className="rounded-lg border border-gray-100 p-3 hover:bg-gray-50">
              <p className="text-xs text-gray-500">{label}</p><p className="text-xl font-bold text-gray-900">{(data.by_status[k] ?? 0).toLocaleString('fr-FR')}</p>
            </a>
          ))}
        </div>
      </div>

      <div className="card p-5 space-y-4">
        <p className="font-semibold text-gray-900">Réglages</p>
        <div className="grid md:grid-cols-3 gap-4">
          <label className="text-sm">Objectif par jour<input type="number" className="input mt-1" value={cfg.daily_goal} onChange={(e) => setCfg({ ...cfg, daily_goal: Number(e.target.value) })} /></label>
          <label className="text-sm">Envois à partir de (h)<input type="number" className="input mt-1" value={cfg.send_from} onChange={(e) => setCfg({ ...cfg, send_from: Number(e.target.value) })} /></label>
          <label className="text-sm">Jusqu&apos;à (h)<input type="number" className="input mt-1" value={cfg.send_to} onChange={(e) => setCfg({ ...cfg, send_to: Number(e.target.value) })} /></label>
        </div>
        <div className="flex gap-2 flex-wrap">
          {DAYS.map((d, i) => {
            const on = cfg.send_days.includes(i + 1);
            return <button key={d} onClick={() => setCfg({ ...cfg, send_days: on ? cfg.send_days.filter((x) => x !== i + 1) : [...cfg.send_days, i + 1].sort() })}
              className={`px-3 py-1 rounded-full text-sm ${on ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>{d}</button>;
          })}
        </div>
        <div className="space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-medium text-gray-700">Parcours</p>
            {(['site', 'no_site'] as const).map((sg) => (
              <button key={sg} onClick={() => setSeg(sg)} className={`px-3 py-1 rounded-full text-sm ${seg === sg ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {SEG_LABEL[sg]} · {(data.leads_by_segment?.[sg] ?? 0).toLocaleString('fr-FR')} leads
              </button>
            ))}
          </div>
          <p className="text-xs text-gray-500">Mail 1 puis relances, envoyés tant que le lead n&apos;a pas répondu. Variables : {'{{first_name}}'}, {'{{company}}'}, {'{{city}}'}, {'{{sector}}'}, {'{{website}}'} et toute colonne de ton fichier. Le pixel d&apos;ouverture et le lien de désinscription sont ajoutés à chaque mail. Modèle vide : Hermès rédige selon les consignes.</p>
          <div className="rounded-lg bg-indigo-50/60 border border-indigo-100 p-3 space-y-2">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs font-semibold text-gray-700">Variables (clic = copier), exemple : {sample?.lead?.company ?? '—'}</p>
              <button className="ml-auto text-xs text-indigo-700" onClick={() => nextSample()}>Autre exemple</button>
            </div>
            <div className="grid sm:grid-cols-2 gap-x-4 gap-y-1">
              {VARS_HELP.map((v) => (
                <button key={v.key} type="button" title={v.label} onClick={() => { navigator.clipboard?.writeText(`{${v.key}}`); toast.success(`{${v.key}} copié`); }}
                  className="text-left text-xs truncate hover:bg-white rounded px-1">
                  <code className="text-indigo-700">{`{${v.key}}`}</code> <span className="text-gray-500">{sample?.variables?.[v.key] || '—'}</span>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-gray-500">Valeur de secours si la donnée manque : <code>{'{ville|votre ville}'}</code>. Les autres colonnes de ton fichier marchent aussi : <code>{'{nom_de_colonne}'}</code>.</p>
          </div>
          {steps.map((st, i) => (
            <div key={i} className="rounded-lg border border-gray-100 p-3 space-y-2">
              <div className="flex items-center gap-3 text-sm"><b>{i === 0 ? 'Mail 1' : `Relance ${i}`}</b>
                {i > 0 && <span className="text-gray-500 inline-flex items-center gap-1">envoyée <input type="number" min={1} className="input w-16 py-1" value={st.delay_days} onChange={(e) => setStep(i, { delay_days: Number(e.target.value) })} /> jours après le mail précédent</span>}
                {i > 0 && i === steps.length - 1 && <button className="ml-auto text-xs text-red-600" onClick={() => setSteps(steps.slice(0, -1))}>Supprimer</button>}
              </div>
              <input className="input text-sm" placeholder={i === 0 ? 'Objet' : 'Objet (vide : réponse dans le même fil, « Re: »)'} value={st.subject} onChange={(e) => setStep(i, { subject: e.target.value })} />
              <textarea className="input text-sm" rows={i === 0 ? 7 : 4} placeholder="Corps du mail" value={st.body} onChange={(e) => setStep(i, { body: e.target.value })} />
              {(st.subject || st.body) && sample?.variables && (() => {
                const missing = new Set<string>();
                const subj = renderVars(st.subject, sample.variables, missing), body = renderVars(st.body, sample.variables, missing);
                return (
                  <div className="rounded-md bg-gray-50 p-2.5 text-sm">
                    <p className="text-[11px] text-gray-500 mb-1">Aperçu pour {sample.lead?.company}</p>
                    {subj && <p className="font-semibold text-gray-900">{subj}</p>}
                    <p className="text-gray-800 whitespace-pre-line">{body}</p>
                    {!!missing.size && <p className="text-[11px] text-amber-700 mt-1">Vide pour ce lead : {Array.from(missing).map((k) => `{${k}}`).join(', ')} — ajoute une valeur de secours ({'{'}{Array.from(missing)[0]}|…{'}'})</p>}
                  </div>
                );
              })()}
            </div>
          ))}
          {steps.length < 6 && <button className="btn-secondary text-sm" onClick={() => setSteps([...steps, { step: steps.length + 1, delay_days: 3, subject: '', body: '' }])}>Ajouter une relance</button>}
        </div>
        <div className="grid md:grid-cols-2 gap-4">
          <label className="text-sm">Adresse d&apos;envoi<input className="input mt-1" value={cfg.sender_email ?? ''} onChange={(e) => setCfg({ ...cfg, sender_email: e.target.value })} /></label>
          <label className="text-sm">Nom affiché<input className="input mt-1" value={cfg.sender_name ?? ''} onChange={(e) => setCfg({ ...cfg, sender_name: e.target.value })} /></label>
        </div>
        <label className="text-sm block">Signature (ajoutée à la fin de chaque mail : Gmail n&apos;ajoute pas la sienne aux mails envoyés par Hermès)
          <textarea className="input mt-1 text-sm" rows={4} value={cfg.signature ?? ''} placeholder={'Lomig Guégueniat\nPayment Flow\n06 …'} onChange={(e) => setCfg({ ...cfg, signature: e.target.value })} />
        </label>
        <label className="text-sm block">Consignes de rédaction pour Hermès
          <textarea className="input mt-1 text-sm" rows={4} value={cfg.instructions} placeholder="Ton, longueur, offre, ce qu'il ne faut jamais écrire…" onChange={(e) => setCfg({ ...cfg, instructions: e.target.value })} />
        </label>
        <button className="btn-primary text-sm" disabled={save.isPending} onClick={() => save.mutate(cfg)}>Enregistrer</button>
      </div>

      <div className="card p-5 text-sm space-y-2">
        <p className="font-semibold text-gray-900 flex items-center gap-2"><Bot className="w-4 h-4" />Connexion de Hermès</p>
        <p className={data.agent_configured ? 'text-emerald-700' : 'text-amber-700'}>{data.agent_configured ? 'Clé de l\'agent configurée.' : 'Clé de l\'agent pas encore configurée (EMAILING_AGENT_KEY).'}</p>
        <p className={cfg.imap_error ? 'text-red-600' : 'text-gray-600'}>Lecture des réponses (boîte {cfg.sender_email}) : {cfg.imap_error ? `erreur — ${cfg.imap_error}` : cfg.imap_checked_at ? `dernier relevé ${new Date(cfg.imap_checked_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' })}` : 'pas encore active (mot de passe d\'application à ajouter)'}</p>
        <p className="text-gray-600">Dernier événement reçu : {data.last_event_at ? new Date(data.last_event_at).toLocaleString('fr-FR', { timeZone: 'Europe/Paris' }) : 'aucun'}</p>
      </div>
    </div>
  );
}
