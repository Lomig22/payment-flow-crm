'use client';
import { useState } from 'react';
import {
  BookOpen, Phone, MessageSquare, Flame, FileDown,
  ChevronDown, ChevronUp, Copy, Check, ExternalLink,
  AlertTriangle, Info, Wifi, Clock, Users, Target,
  Instagram, Facebook, Calendar,
} from 'lucide-react';

/* ─── Copy-to-clipboard button ────────────────────────────────────── */
function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };
  return (
    <button
      onClick={copy}
      title="Copier"
      className="p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors flex-shrink-0"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-500" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

/* ─── Script block ────────────────────────────────────────────────── */
function Script({ label, color, text }: { label: string; color: string; text: string }) {
  return (
    <div className={`rounded-xl border-2 ${color} overflow-hidden`}>
      <div className={`flex items-center justify-between px-4 py-2 ${color.replace('border-', 'bg-').replace('-300', '-50').replace('-400', '-50')}`}>
        <span className="text-xs font-semibold text-gray-700">{label}</span>
        <CopyBtn text={text} />
      </div>
      <pre className="p-4 text-sm text-gray-800 whitespace-pre-wrap font-sans leading-relaxed bg-white">
        {text}
      </pre>
    </div>
  );
}

/* ─── Accordion section ───────────────────────────────────────────── */
function Section({
  id, icon, title, badge, color, defaultOpen = false, children,
}: {
  id: string; icon: React.ReactNode; title: string; badge?: string;
  color: string; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className={`rounded-2xl border-2 ${color} overflow-hidden`} id={id}>
      <button
        onClick={() => setOpen((v) => !v)}
        className={`w-full flex items-center gap-3 px-5 py-4 text-left transition-colors ${
          open ? `${color.replace('border-', 'bg-').replace('-300', '-100').replace('-400', '-100')}` : 'bg-white hover:bg-gray-50'
        }`}
      >
        <span className="flex-shrink-0">{icon}</span>
        <span className="flex-1 font-semibold text-gray-900">{title}</span>
        {badge && (
          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${color.replace('border-', 'bg-').replace('-300', '-100').replace('-400', '-100')} ${color.replace('border-', 'text-').replace('-300', '-700').replace('-400', '-700')}`}>
            {badge}
          </span>
        )}
        {open
          ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />
        }
      </button>
      {open && <div className="p-5 bg-white border-t border-gray-100 space-y-5">{children}</div>}
    </div>
  );
}

/* ─── Info box ────────────────────────────────────────────────────── */
function InfoBox({ type = 'info', children }: { type?: 'info' | 'warning' | 'danger'; children: React.ReactNode }) {
  const styles = {
    info:    'bg-blue-50 border-blue-200 text-blue-800',
    warning: 'bg-amber-50 border-amber-200 text-amber-800',
    danger:  'bg-red-50 border-red-200 text-red-800',
  };
  const Icon = type === 'danger' ? AlertTriangle : Info;
  return (
    <div className={`flex gap-2 p-3 rounded-lg border text-sm ${styles[type]}`}>
      <Icon className="w-4 h-4 mt-0.5 flex-shrink-0" />
      <div>{children}</div>
    </div>
  );
}

/* ─── Warm-up table ──────────────────────────────────────────────── */
function WarmupTable({ rows, columns }: { rows: string[][]; columns: string[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-gray-200">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-gray-50 border-b border-gray-200">
            {columns.map((c) => (
              <th key={c} className="text-left px-3 py-2 text-xs font-semibold text-gray-600">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {rows.map((row, i) => (
            <tr key={i} className="hover:bg-gray-50">
              {row.map((cell, j) => (
                <td key={j} className={`px-3 py-2 text-gray-700 ${j === 0 ? 'font-semibold text-indigo-600' : ''}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Main page ───────────────────────────────────────────────────── */
export default function RessourcesPage() {
  return (
    <div className="max-w-3xl mx-auto space-y-4">

      {/* Header */}
      <div className="flex items-center gap-3 pb-1">
        <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center flex-shrink-0">
          <BookOpen className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-base font-bold text-gray-900">Base de connaissances Setter</h1>
          <p className="text-xs text-gray-500">Scripts, protocoles, processus — tout ce qu'il faut pour bien travailler</p>
        </div>
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          { label: 'Onboarding',    href: '#onboarding',  color: 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100' },
          { label: 'Scripts',       href: '#scripts',     color: 'bg-green-50 text-green-700 hover:bg-green-100'   },
          { label: 'DM Chatting',   href: '#chatting',    color: 'bg-pink-50 text-pink-700 hover:bg-pink-100'      },
          { label: 'Warm-up',       href: '#warmup',      color: 'bg-orange-50 text-orange-700 hover:bg-orange-100'},
        ].map(({ label, href, color }) => (
          <a key={href} href={href}
            className={`text-center py-2 px-3 rounded-lg text-xs font-semibold transition-colors ${color}`}
          >
            {label}
          </a>
        ))}
      </div>

      {/* ── 1. Onboarding ───────────────────────────────────────── */}
      <Section id="onboarding" icon={<Target className="w-5 h-5 text-indigo-600" />}
        title="Onboarding — Ton rôle & la cible" color="border-indigo-300" defaultOpen={true}>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">🎯 Avatar client</h3>
            <div className="bg-indigo-50 rounded-xl p-4 space-y-1.5 text-sm text-gray-700">
              <p>• Artisans et dirigeants (gérants, CEO)</p>
              <p>• Entreprises du bâtiment — rénovation, gros œuvre, terrassement, maçonnerie</p>
              <p>• <strong>1 à 10 salariés</strong> — hors plomberie</p>
              <p>• Partout en France — EI, SARL, EURL</p>
            </div>
          </div>
          <div className="space-y-3">
            <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">🛠️ Nos 3 offres</h3>
            <div className="space-y-2">
              {[
                ['🌐', 'Création / refonte de site web', 'Maquette offerte comme accroche'],
                ['📈', 'SEO / SEA', 'Audit gratuit via Lighthouse'],
                ['📱', 'Contenu réseaux sociaux', 'Gestion et création de contenu'],
              ].map(([icon, title, sub]) => (
                <div key={title} className="flex items-start gap-2 p-2.5 rounded-lg bg-gray-50 text-sm">
                  <span className="text-base leading-none mt-0.5">{icon}</span>
                  <div>
                    <p className="font-medium text-gray-800">{title}</p>
                    <p className="text-xs text-gray-500">{sub}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">🔗 Liens essentiels</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {[
              {
                label: 'Calendly — Prévisualisation site web',
                url: 'https://calendly.com/paymentfloww/prevuesiteweb',
                desc: 'Lien principal pour les prospects sans site',
              },
              {
                label: 'Lemcal — Consultation gratuite',
                url: 'https://app.lemcal.com/@lomig-guegueniat/consultation-gratuit',
                desc: 'Lien pour prospects avec site (SEO/SEA)',
              },
              {
                label: 'Vidéo onboarding YouTube',
                url: 'https://www.youtube.com/watch?v=s4zTxGgRNcY',
                desc: 'Regarder en priorité avant de commencer',
              },
            ].map(({ label, url, desc }) => (
              <a key={url} href={url} target="_blank" rel="noopener noreferrer"
                className="flex items-start gap-2 p-3 rounded-lg border border-gray-200 hover:border-indigo-300 hover:bg-indigo-50 transition-colors group">
                <ExternalLink className="w-4 h-4 text-indigo-500 flex-shrink-0 mt-0.5 group-hover:text-indigo-700" />
                <div>
                  <p className="text-sm font-medium text-gray-800 group-hover:text-indigo-700">{label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
                </div>
              </a>
            ))}
          </div>
        </div>

        <InfoBox type="info">
          <strong>Vérifier le SEO d'un prospect :</strong> Aller sur son site → Clique droit → Inspecter → flèches à côté de "Appli" → <strong>Lighthouse</strong> → Analyser le chargement.
        </InfoBox>
      </Section>

      {/* ── 2. Scripts cold call ────────────────────────────────── */}
      <Section id="scripts" icon={<Phone className="w-5 h-5 text-green-600" />}
        title="Scripts Cold Call" badge="2 cas" color="border-green-300">

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-5 h-5 bg-green-100 text-green-700 rounded text-xs font-bold flex items-center justify-center">1</span>
            Cas N°1 — Prospect avec site web (SEO / SEA / Refonte)
          </h3>
          <Script label="Script complet — Cas 1" color="border-green-300" text={`Bonjour [Prénom],

Je suis [votre prénom] de l'agence Payment Flow, comment allez-vous ?

[Réponse du prospect → mesurer la température : peur, méfiance, confiance…]

Je me permets de vous appeler car je suis tombé sur votre site [sur la source].

Chez Payment Flow, nous aidons des entreprises comme {{companyName}} à développer leur croissance grâce à leur visibilité en ligne.

Nous accompagnons de nombreuses entreprises du bâtiment comme Axel Segura Renovation, Nord-Bois Structure ou Aurora Solution par exemple.

Et c'est dans ce sens que j'aimerais vraiment prendre 10 minutes avec vous pour vous présenter votre audit de référencement spécialement conçu pour votre entreprise gratuitement !

[Réponse du client 😃]

Notre but est simplement de voir avec vous comment nous pourrions vous accompagner à développer votre chiffre d'affaire sur le long terme. Il s'agit d'un appel en visio-conférence d'environ une heure tout au plus. Dans tous les cas vous repartirez avec votre audit gratuitement à l'issue de l'appel.

[Si appel en milieu de semaine jusqu'à jeudi]
Quelles seraient vos disponibilités dans la semaine pour planifier un échange avec mon équipe ?

[Si appel à partir de vendredi]
Quelles seraient vos disponibilités la semaine prochaine pour planifier un échange avec mon équipe ?

👉 Lien Lemcal : https://app.lemcal.com/@lomig-guegueniat/consultation-gratuit`} />

          <InfoBox type="warning">
            Après le booking : poser les questions obligatoires du formulaire (voir Lemcal). Collecter : numéro de téléphone, email, nom de l'entreprise.
          </InfoBox>
        </div>

        <div className="space-y-4">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <span className="w-5 h-5 bg-green-100 text-green-700 rounded text-xs font-bold flex items-center justify-center">2</span>
            Cas N°2 — Prospect sans site web
          </h3>
          <Script label="Script complet — Cas 2" color="border-green-300" text={`Bonjour [Prénom],

Je suis [votre prénom] de l'agence Payment Flow,

Je me permets de vous appeler car je suis tombé sur votre [source]. J'ai remarqué que vous n'aviez pas de site web.

Avec mon équipe, nous vous avons préparé une maquette de site web spécialement conçue pour VOTRE entreprise !

L'idée est de pouvoir voir ensemble comment ce site web pourrait augmenter votre chiffre d'affaire de +20% en moins de 90 jours. Nous souhaitons vous le montrer et surtout avoir votre avis sur notre réalisation !

[Si appel en milieu de semaine jusqu'à jeudi]
Quelles seraient vos disponibilités dans la semaine pour planifier un échange avec un membre de mon équipe ?

[Si appel à partir de vendredi]
Quelles seraient vos disponibilités la semaine prochaine pour planifier un échange avec mon équipe ?

👉 Lien Calendly : https://calendly.com/paymentfloww/prevuesiteweb`} />
        </div>

        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
            <Clock className="w-4 h-4 text-orange-500" />
            Message de confirmation J-3 (WhatsApp)
          </h3>
          <Script label="Message J-3 avant RDV" color="border-orange-300" text={`Hello [Prénom] 👋,

🚨 J-3 avant notre échange !

👉 Assure-toi d'être dans un endroit calme avec ta caméra et ton micro qui fonctionnent !

Nous avons hâte de te rencontrer et d'échanger avec toi autour de l'acquisition digitale.

Je te remets le lien de la visio au cas où 👇
[Lien Google Meet]

À [Jour de la call] !
Cordialement,
[Ton prénom]`} />
        </div>
      </Section>

      {/* ── 3. Scripts DM Chatting ───────────────────────────────── */}
      <Section id="chatting" icon={<MessageSquare className="w-5 h-5 text-pink-600" />}
        title="Scripts DM Chatting" badge="Instagram / Facebook" color="border-pink-300">

        {/* Cas 1 — Sans site */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-green-500" />
            CAS 1 — Prospect sans site web
          </h3>
          <Script label="🟢 Message 1 — Curiosité" color="border-green-300" text={`👋 Bonjour (Prénom),

J'ai pris 15 minutes pour créer un aperçu de site web pensé spécifiquement pour (Entreprise).

Rien à vendre ici — juste un visuel que j'aimerais vous montrer.

👉 Je vous le montre ?`} />
          <Script label="🟡 Message 2 — Humanisation (CLÉ) — quand il dit oui" color="border-yellow-300" text={`Super 😃😊

Je viens de terminer l'aperçu de votre site web ! Je suis certain qu'il correspond parfaitement à votre image 😊

Je vous propose que l'on planifie ensemble un moment d'échange pour que je vous le présente ? Je vous montrerai comment ce site peut devenir un vrai levier pour développer votre chiffre d'affaires, sans que vous ayez à prospecter 🚀

👉 Quel horaire vous conviendrait le plus (Prénom) ?
(Lien Calendly)`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Script label="🔴 Relance 1 — J+2" color="border-red-200" text={`Bonjour (Prénom) 😊

Je voulais juste m'assurer que mon message vous avait bien atteint !

L'aperçu de votre site est prêt, ça prend 10 minutes à regarder ensemble et ça pourrait vraiment changer la donne pour (Entreprise).

👉 On se cale un moment cette semaine ?`} />
            <Script label="🔴 Relance 2 — J+5" color="border-red-200" text={`(Prénom), je vous laisse ce dernier message 🙏

J'ai mis du temps sur cet aperçu spécifiquement pour vous, ce serait dommage de ne pas en profiter.

Si ce n'est pas le bon moment, pas de souci, dites-le moi juste et je ne vous recontacte plus.

👉 Sinon, 10 minutes suffisent : (Lien Calendly)`} />
          </div>
        </div>

        {/* Cas 2 — Avec site */}
        <div className="space-y-3">
          <h3 className="text-sm font-semibold text-gray-700 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-blue-500" />
            CAS 2 — Prospect avec site web existant
          </h3>
          <Script label="🟢 Message 1" color="border-green-300" text={`👋 Salut (Prénom),

J'ai pris quelques minutes pour regarder (Entreprise).

J'ai remarqué un point intéressant sur votre présence en ligne.

Juste un retour si ça peut être utile.

👉 Je vous le partage ?`} />
          <Script label="🟡 Message 2 — quand il dit oui" color="border-yellow-300" text={`Super 😃

Je vous propose que l'on planifie ensemble un moment d'échange pour en discuter ?

👉 Quel horaire vous conviendrait le plus (Prénom) ?
(Lien Calendly)`} />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Script label="🔴 Relance 1 — J+2" color="border-red-200" text={`Bonjour (Prénom) 😊

Je voulais m'assurer que vous aviez bien vu mon message !

Le point que j'ai remarqué sur (Entreprise) peut vraiment faire la différence, ça vaut 10 minutes d'échange.

👉 On se cale un moment cette semaine ?`} />
            <Script label="🔴 Relance 2 — J+5" color="border-red-200" text={`(Prénom), je vous laisse ce dernier message 🙏

J'ai quelque chose de concret à vous partager sur votre présence en ligne, pas du blabla, un vrai retour terrain.

Si ce n'est pas le bon moment, dites-le moi et je n'insiste plus.

👉 Sinon : (Lien Calendly)`} />
          </div>
        </div>

        {/* Schéma contact */}
        <div className="rounded-xl bg-gray-50 border border-gray-200 p-4">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            📊 Schéma du parcours de contact
          </h3>
          <div className="flex items-center gap-2 text-xs text-center overflow-x-auto pb-1">
            {[
              { label: 'MSG 1', sub: 'J0', color: 'bg-green-100 text-green-700 border-green-300' },
              { label: '→', sub: 'J+2', color: 'bg-transparent text-gray-400 border-transparent' },
              { label: 'RELANCE 1', sub: 'J+2', color: 'bg-yellow-100 text-yellow-700 border-yellow-300' },
              { label: '→', sub: 'J+5', color: 'bg-transparent text-gray-400 border-transparent' },
              { label: 'RELANCE 2', sub: 'J+5', color: 'bg-red-100 text-red-700 border-red-300' },
              { label: '→', sub: '', color: 'bg-transparent text-gray-400 border-transparent' },
              { label: 'STOP', sub: 'Archiver', color: 'bg-gray-100 text-gray-600 border-gray-300' },
            ].map(({ label, sub, color }, i) => (
              <div key={i} className={`flex-shrink-0 ${label === '→' ? '' : `rounded-lg border px-3 py-2 ${color}`}`}>
                <p className="font-bold">{label}</p>
                {sub && <p className="text-gray-500 text-xs">{sub}</p>}
              </div>
            ))}
          </div>
          <InfoBox type="info">
            Si le lead répond à n'importe quelle étape → il passe immédiatement en pipe commercial. Après Relance 2 sans réponse → archiver, ne plus recontacter.
          </InfoBox>
        </div>
      </Section>

      {/* ── 4. Warm-up ──────────────────────────────────────────── */}
      <Section id="warmup" icon={<Flame className="w-5 h-5 text-orange-500" />}
        title="Warm-up Comptes Instagram & Facebook" badge="Obligatoire" color="border-orange-300">

        {/* Principe */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">Principe général</h3>
          <div className="bg-orange-50 rounded-xl p-4 space-y-2">
            {[
              'Ne jamais agir de manière robotique (même heure, même durée chaque jour)',
              'Varier les horaires : matin, midi, soir — comme un vrai utilisateur',
              'Chaque session de scroll : 5 à 15 minutes, 2 à 4 fois par jour',
              'Liker occasionnellement, regarder des Stories, visiter des profils',
              'Ne pas changer d\'IP brutalement — utiliser un proxy/VPN stable',
            ].map((rule, i) => (
              <div key={i} className="flex gap-2 text-sm text-gray-700">
                <span className="w-5 h-5 rounded-full bg-orange-200 text-orange-700 text-xs font-bold flex items-center justify-center flex-shrink-0 mt-0.5">
                  {i + 1}
                </span>
                {rule}
              </div>
            ))}
          </div>
        </div>

        {/* VPN */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <Wifi className="w-3.5 h-3.5" /> VPN — Connexion obligatoire depuis la France
          </h3>
          <div className="rounded-xl border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <tbody className="divide-y divide-gray-100">
                {[
                  ['VPN recommandé', 'VPNify — iOS & Android. Serveur France (Paris de préférence)'],
                  ['Quand l\'activer', 'Avant d\'ouvrir Instagram ou Facebook. Jamais sans VPN hors de France'],
                  ['Cohérence IP', 'Ne pas changer de serveur d\'une session à l\'autre — même serveur France'],
                  ['Vérification', 'Avant de commencer : whatismyip.com → doit afficher une ville française'],
                ].map(([k, v]) => (
                  <tr key={k}>
                    <td className="px-3 py-2 font-medium text-gray-600 bg-gray-50 w-40">{k}</td>
                    <td className="px-3 py-2 text-gray-700">{v}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="space-y-1.5">
            {[
              'Règle absolue : 1 compte = 1 IP France fixe. Si tu changes de VPN, Instagram peut restreindre le compte.',
              'Ne jamais désactiver le VPN en cours de session. Si la connexion tombe, fermer l\'appli immédiatement.',
              'VPNify : activer le démarrage automatique au lancement du téléphone.',
            ].map((r) => <InfoBox key={r} type="danger">{r}</InfoBox>)}
          </div>
        </div>

        {/* Instagram warm-up table */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <Instagram className="w-3.5 h-3.5" /> Instagram — Warm-up 7 jours
          </h3>
          <WarmupTable
            columns={['Jour', 'Scroll', 'DMs max', 'Notes']}
            rows={[
              ['J1', '3x/j · 5-10 min', '0', 'Créer le compte, compléter le profil, suivre 10-20 comptes du niche'],
              ['J2', '3x/j · 10-15 min', '0', 'Liker des posts, regarder des Stories, visiter des profils cibles'],
              ['J3', '3x/j · 10-15 min', '10', '1ers DMs le soir uniquement. Espacer : 1 DM toutes les 5-10 min'],
              ['J4', '3-4x/j · 10-15 min', '20', 'Répartir sur la journée. Continuer le scroll normal'],
              ['J5', '3-4x/j · 10-15 min', '30', 'Augmenter progressivement. Ne pas dépasser la limite du jour'],
              ['J6', '3-4x/j · 10-15 min', '40', 'Surveiller les éventuels warnings du compte'],
              ['J7', '3-4x/j · 10-15 min', '50', 'Palier avant régime de croisière'],
              ['J8+', '2-3x/j', '60 max', 'Régime de croisière. Ne jamais dépasser 60 DMs/jour'],
            ]}
          />
          <div className="space-y-1.5">
            <InfoBox type="warning">Espacer les DMs : minimum 3-5 min entre chaque envoi. Ne jamais envoyer en rafale.</InfoBox>
            <InfoBox type="danger">Si avertissement Instagram : stopper les DMs 24h, continuer le scroll uniquement.</InfoBox>
            <InfoBox type="warning">Utiliser des messages variés — jamais le même texte copié-collé en boucle.</InfoBox>
          </div>
        </div>

        {/* Facebook warm-up table */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider flex items-center gap-1">
            <Facebook className="w-3.5 h-3.5" /> Facebook — Warm-up 7 jours
          </h3>
          <WarmupTable
            columns={['Jour', 'Scroll', 'Actions recommandées']}
            rows={[
              ['J1', '3x/j · 5-10 min', 'Créer/configurer le profil. Photo, bio. Rejoindre 2-3 groupes du niche.'],
              ['J2', '3x/j · 10-15 min', 'Scroller le fil d\'actu. Liker 5-10 posts. Commenter 1-2 posts naturellement.'],
              ['J3', '3x/j · 10-15 min', 'Parcourir des groupes. Liker des publications. Regarder quelques Reels Facebook.'],
              ['J4', '3-4x/j · 10-15 min', 'Interagir dans les groupes rejoints. Ajouter 3-5 amis du niche.'],
              ['J5', '3-4x/j · 10-15 min', 'Continuer les interactions. Partager ou commenter 1 post de groupe.'],
              ['J6', '3-4x/j · 10-15 min', 'Activité normale. Possibilité de commencer des DMs légers (5-10 max).'],
              ['J7', '3-4x/j · 10-15 min', 'Dernière journée de chauffe. Profil stabilisé, prêt pour montée en charge.'],
            ]}
          />
          <InfoBox type="danger">Facebook est plus strict sur les comptes neufs — ne jamais envoyer 60 DMs/jour dès le départ.</InfoBox>
          <InfoBox type="warning">Rejoindre des groupes actifs est clé : cela crédibilise le profil rapidement.</InfoBox>
        </div>

        {/* Répartition sessions */}
        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wider">
            Répartition des sessions dans la journée
          </h3>
          <WarmupTable
            columns={['Créneau', 'Heure indicative', 'Durée', 'Action']}
            rows={[
              ['Matin', '8h00 - 9h30', '5-10 min', 'Scroll fil d\'actu, quelques likes'],
              ['Midi', '12h30 - 14h00', '10-15 min', 'Scroll + visiter profils + Stories'],
              ['Après-midi', '16h00 - 18h00', '5-10 min', 'Scroll rapide, interactions légères'],
              ['Soir', '20h00 - 22h00', '10-15 min', 'Session principale — DMs si applicable'],
            ]}
          />
          <InfoBox type="info">Varier de 15 à 30 minutes chaque jour pour éviter tout pattern détectable.</InfoBox>
        </div>
      </Section>

      {/* ── 5. Documents ────────────────────────────────────────── */}
      <Section id="docs" icon={<FileDown className="w-5 h-5 text-gray-600" />}
        title="Documents à télécharger" color="border-gray-300">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {[
            { name: 'Processus Warm-Up complet',    file: 'processus-warmup.pdf',    desc: 'Guide opérationnel 17 pages — comptes IG & FB',    color: 'text-orange-600 bg-orange-50 border-orange-200' },
            { name: 'Script de Chatting',           file: 'script-chatting.pdf',    desc: 'Scripts DM Instagram & Facebook avec relances',    color: 'text-pink-600 bg-pink-50 border-pink-200'       },
            { name: 'Setting — Onboarding',         file: 'setting-onboarding.pdf', desc: 'Guide du setter : scripts cold call et processus', color: 'text-green-600 bg-green-50 border-green-200'    },
            { name: 'Guide Warm-Up IG & FB',        file: 'warmup-guide.pdf',       desc: 'Protocole d\'activation rapide avec tableaux',     color: 'text-orange-600 bg-orange-50 border-orange-200' },
            { name: 'E-book Acquisition Digitale',  file: 'ebook-acquisition.pdf',  desc: 'Formats gagnants 2026 — à partager aux prospects', color: 'text-indigo-600 bg-indigo-50 border-indigo-200' },
          ].map(({ name, file, desc, color }) => (
            <a key={file} href={`/docs/${file}`} download
              className={`flex items-start gap-3 p-3 rounded-xl border transition-all hover:shadow-sm hover:-translate-y-px ${color}`}>
              <FileDown className="w-5 h-5 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold">{name}</p>
                <p className="text-xs opacity-70 mt-0.5">{desc}</p>
              </div>
            </a>
          ))}
        </div>
      </Section>

    </div>
  );
}
