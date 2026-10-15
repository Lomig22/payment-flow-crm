'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { RotateCcw, AlertTriangle, CheckCircle2, Plus, Trash2 } from 'lucide-react';
import { linkedinApi, type LinkedinSettings } from '@/lib/api';
import { LinkedinShell } from '@/components/linkedin/parts';
import { SECTORS } from '@/lib/linkedinLabels';
import { TEMPLATE_DEFAULTS, TEMPLATE_META, VAR_HELP, checkMessage, MAX_CHARS, type TemplateKey } from '@/lib/linkedinTemplates';
import { relancesOf, MAX_RELANCES, type Relance } from '@/lib/linkedinSequence';

// LinkedIn · Messages : les gabarits de la séquence (notes d'invitation, premier message A / B / C,
// questions, relances). Modifiables ; un gabarit vidé reprend le texte d'origine. L'aperçu les
// assemble pour un lead d'exemple et signale les règles non respectées (le message serait écarté).

const SAMPLE = {
  prenom: 'Julien', entreprise: 'Menuiserie Roux', sujet: 'votre dernier escalier sur mesure',
  element: 'le choix du chêne massif', fait: 'Vingt ans à la tête de votre atelier',
};

function render(all: Record<TemplateKey, string>, key: TemplateKey, q: 'cout_client' | 'regularite' = 'cout_client'): string {
  const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (m, k) => (k in v ? v[k] : m)).replace(/[ \t]{2,}/g, ' ').trim();
  const ouverture = fill(all.ouverture, { prenom: SAMPLE.prenom });
  const vars: Record<string, string> = {
    ...SAMPLE, ouverture, question: fill(all[`q_${q}`], {}), question_courte: fill(all[`qc_${q}`], {}),
    pour_entreprise: `pour ${SAMPLE.entreprise}`, chez_entreprise: `Chez ${SAMPLE.entreprise}`,
  };
  return fill(all[key], vars);
}
const FIRST: TemplateKey[] = ['a', 'b', 'c_entreprise', 'c'];
const QUESTION_ONLY: TemplateKey[] = ['q_cout_client', 'q_regularite', 'qc_cout_client', 'qc_regularite', 'ouverture'];

function Editor({ settings }: { settings: LinkedinSettings }) {
  const qc = useQueryClient();
  const [msgs, setMsgs] = useState<Record<string, string>>({});
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [relances, setRelances] = useState<Relance[]>([]);
  useEffect(() => {
    setMsgs({ ...TEMPLATE_DEFAULTS, ...(settings.msg_templates ?? {}) });
    setNotes(settings.note_templates ?? {});
    setRelances(relancesOf(settings as any));
  }, [settings]);
  const setRelance = (i: number, patch: Partial<Relance>) => setRelances(relances.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const all = msgs as Record<TemplateKey, string>;
  const save = useMutation({
    mutationFn: () => {
      // Seuls les textes différents de l'original sont enregistrés
      const msg_templates = Object.fromEntries(Object.entries(msgs).filter(([k, v]) => v.trim() && v.trim() !== TEMPLATE_DEFAULTS[k as TemplateKey]).map(([k, v]) => [k, v.trim()]));
      const note_templates = Object.fromEntries(Object.entries(notes).filter(([, v]) => v.trim()).map(([k, v]) => [k, v.trim()]));
      const empty = relances.findIndex((r) => !r.cout_client.trim() && !r.regularite.trim());
      if (empty >= 0) throw Object.assign(new Error(`R${empty + 1} : texte vide`), { response: { data: { message: `R${empty + 1} : écrivez un texte ou supprimez la relance` } } });
      return linkedinApi.saveSettings({ msg_templates, note_templates, relances: relances.map((r) => ({ delay_days: Math.max(1, Math.round(r.delay_days)), cout_client: r.cout_client.trim(), regularite: r.regularite.trim() })) });
    },
    onSuccess: () => { toast.success('Messages enregistrés : ils s\'appliquent aux prochains envois'); qc.invalidateQueries({ queryKey: ['linkedin'] }); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Erreur'),
  });
  const groups = useMemo(() => Array.from(new Set(TEMPLATE_META.map((m) => m.group))), []);
  if (!Object.keys(msgs).length) return null;

  return (
    <div className="space-y-6">
      <div className="card p-5 space-y-3">
        <div>
          <p className="font-semibold text-gray-900">Notes d&apos;invitation</p>
          <p className="text-xs text-gray-500">Jointes à une partie des invitations (test avec ou sans note). Variables : {'{prenom}'}, {'{entreprise}'}. 200 caractères maximum.</p>
        </div>
        {['default', ...Object.keys(SECTORS)].map((k) => (
          <label key={k} className="block">
            <span className="text-xs font-medium text-gray-600">{k === 'default' ? 'Par défaut (tous secteurs)' : SECTORS[k as keyof typeof SECTORS]}</span>
            <textarea className="input mt-1 text-sm min-h-[52px]" maxLength={200} value={notes[k] ?? ''} placeholder={k === 'default' ? 'Aucune note : invitation sans note' : 'Vide : la note par défaut'}
              onChange={(e) => setNotes({ ...notes, [k]: e.target.value })} />
          </label>
        ))}
      </div>

      {groups.map((g) => (
        <div key={g} className="card p-5 space-y-5">
          <p className="font-semibold text-gray-900">{g}</p>
          {TEMPLATE_META.filter((m) => m.group === g).map((m) => {
            const changed = (msgs[m.key] ?? '').trim() !== TEMPLATE_DEFAULTS[m.key];
            const preview = QUESTION_ONLY.includes(m.key) ? null : render(all, m.key, m.key.endsWith('regularite') ? 'regularite' : 'cout_client');
            const issues = preview ? checkMessage(preview, { first: FIRST.includes(m.key) }) : [];
            return (
              <div key={m.key} className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-medium text-gray-800">{m.label}</p>
                  <span className="text-xs text-gray-500">· {m.when}</span>
                  {changed && <button className="ml-auto text-xs text-gray-500 hover:text-gray-800 inline-flex items-center gap-1" onClick={() => setMsgs({ ...msgs, [m.key]: TEMPLATE_DEFAULTS[m.key] })}><RotateCcw className="w-3 h-3" />Texte d&apos;origine</button>}
                </div>
                <textarea className="input text-sm min-h-[64px]" maxLength={600} value={msgs[m.key] ?? ''} onChange={(e) => setMsgs({ ...msgs, [m.key]: e.target.value })} />
                {!!m.vars.length && <p className="text-[11px] text-gray-500">Variables : {m.vars.map((v) => <span key={v} className="mr-2"><code className="text-[#0a66c2]">{`{${v}}`}</code> {VAR_HELP[v]}</span>)}</p>}
                {preview && (
                  <div className={`rounded-md p-2.5 text-sm ${issues.length ? 'bg-amber-50 border border-amber-200' : 'bg-gray-50'}`}>
                    <p className="text-gray-800">{preview}</p>
                    <p className={`mt-1 text-[11px] inline-flex items-center gap-1 ${issues.length ? 'text-amber-700' : 'text-emerald-700'}`}>
                      {issues.length ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle2 className="w-3 h-3" />}
                      {issues.length ? `Ne passera pas les règles : ${issues.join(', ')}` : `${preview.length} / ${MAX_CHARS} caractères, règles respectées`}
                    </p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}

      <div className="card p-5 space-y-5">
        <div>
          <p className="font-semibold text-gray-900">Relances · {relances.length} / {MAX_RELANCES}</p>
          <p className="text-xs text-gray-500">Chaque relance part le nombre de jours ouvrés indiqué après le message précédent, tant que le lead n&apos;a pas répondu. Un texte par question posée au premier message (Q1 coût client, Q2 régularité) ; si l&apos;un est vide, l&apos;autre sert pour les deux. Variables : {'{prenom}'}, {'{entreprise}'}, {'{pour_entreprise}'}, {'{chez_entreprise}'}, {'{question}'}, {'{question_courte}'}. Si le lead vient de publier, une relance « post » peut remplacer la relance prévue.</p>
        </div>
        {relances.map((r, i) => (
          <div key={i} className="rounded-lg border border-gray-100 p-3 space-y-2">
            <div className="flex items-center gap-3 text-sm">
              <b>R{i + 1}</b>
              <span className="text-gray-500 inline-flex items-center gap-1.5">
                <input type="number" min={1} max={60} className="input w-16 py-1" value={r.delay_days} onChange={(e) => setRelance(i, { delay_days: Number(e.target.value) })} />
                jours ouvrés après {i === 0 ? 'le premier message' : `R${i}`}
              </span>
              {relances.length > 1 && <button className="ml-auto text-xs text-red-600 inline-flex items-center gap-1" onClick={() => setRelances(relances.filter((_, j) => j !== i))}><Trash2 className="w-3 h-3" />Supprimer</button>}
            </div>
            {(['cout_client', 'regularite'] as const).map((q) => {
              const text = r[q];
              const preview = text.trim() ? render({ ...all, r_tmp: text } as any, 'r_tmp' as TemplateKey, q) : '';
              const issues = preview ? checkMessage(preview, { first: false }) : [];
              return (
                <div key={q} className="space-y-1">
                  <span className="text-xs font-medium text-gray-600">{q === 'cout_client' ? 'Si Q1 (coût client)' : 'Si Q2 (régularité)'}</span>
                  <textarea className="input text-sm min-h-[56px]" maxLength={600} value={text} placeholder={q === 'regularite' ? 'Vide : même texte que pour Q1' : ''} onChange={(e) => setRelance(i, { [q]: e.target.value })} />
                  {preview && (
                    <p className={`text-[11px] ${issues.length ? 'text-amber-700' : 'text-gray-500'}`}>
                      {preview} — {issues.length ? `ne passera pas les règles : ${issues.join(', ')}` : `${preview.length} / ${MAX_CHARS} caractères`}
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        ))}
        {relances.length < MAX_RELANCES && (
          <button className="btn-secondary text-sm inline-flex items-center gap-1.5" onClick={() => setRelances([...relances, { delay_days: 3, cout_client: '', regularite: '' }])}>
            <Plus className="w-4 h-4" />Ajouter une relance (R{relances.length + 1})
          </button>
        )}
      </div>

      <div className="sticky bottom-4 flex justify-end">
        <button className="btn-primary shadow-lg" disabled={save.isPending} onClick={() => save.mutate()}>Enregistrer les messages</button>
      </div>
    </div>
  );
}

export default function LinkedinMessagesPage() {
  return (
    <LinkedinShell title="Messages" subtitle="Les textes envoyés à chaque étape. L'agent ne choisit que le sujet, le point ou le fait cité ; tout le reste vient de ces gabarits.">
      {(d) => <Editor settings={d.settings} />}
    </LinkedinShell>
  );
}
