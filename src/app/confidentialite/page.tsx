import type { Metadata } from 'next';
import Link from 'next/link';

// Page publique exigée par Meta (App Review de l'app Instagram).
export const metadata: Metadata = {
  title: 'Politique de confidentialité — Payment Flow',
};

const UPDATED = '30 septembre 2026';

export default function ConfidentialitePage() {
  return (
    <main className="min-h-screen bg-white">
      <article className="max-w-3xl mx-auto px-4 py-12 text-gray-800 leading-relaxed space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Politique de confidentialité</h1>
          <p className="text-sm text-gray-500">Dernière mise à jour : {UPDATED}</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">1. Responsable du traitement</h2>
          <p>
            Lomig Guégueniat, entrepreneur individuel exerçant sous le nom commercial Payment Flow,
            immatriculé au RCS de Brest sous le numéro 944 989 599, Penn An Neac&apos;h Rozegad,
            29470 Plougastel-Daoulas, France.
            Contact : <a className="text-primary-600 underline" href="mailto:lomig.guegueniat@gmail.com">lomig.guegueniat@gmail.com</a>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">2. Objet</h2>
          <p>
            Payment Flow utilise un outil interne de gestion de la relation client (CRM) connecté à son
            propre compte Instagram professionnel. Cette politique décrit les données traitées par cet outil,
            notamment via l&apos;API Instagram de Meta.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">3. Données traitées</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Contenus et statistiques de notre compte Instagram</strong> : publications, stories,
              légendes, nombre de vues, portée, interactions et visites du profil.
            </li>
            <li>
              <strong>Commentaires publiés sous nos contenus</strong> : nom d&apos;utilisateur Instagram,
              texte du commentaire et date.
            </li>
            <li>
              <strong>Messages privés adressés à notre compte</strong> : nom d&apos;utilisateur Instagram,
              contenu des messages et date.
            </li>
            <li>
              <strong>Données de prospects</strong> que les personnes nous communiquent (nom, entreprise,
              téléphone, e-mail) lorsqu&apos;elles nous contactent.
            </li>
          </ul>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">4. Finalités et bases légales</h2>
          <ul className="list-disc pl-5 space-y-1">
            <li>Publier nos contenus et mesurer leurs performances (intérêt légitime).</li>
            <li>
              Répondre aux personnes qui commentent nos contenus ou nous écrivent, et assurer le suivi de
              leur demande commerciale (mesures précontractuelles à la demande de la personne, intérêt légitime).
            </li>
            <li>Mesurer quels contenus génèrent des demandes de contact (intérêt légitime).</li>
          </ul>
          <p>
            Les données ne sont ni vendues, ni louées, ni utilisées à des fins de publicité ciblée, ni
            transmises à des tiers en dehors des prestataires techniques listés ci-dessous.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">5. Destinataires et hébergement</h2>
          <p>
            Seuls Payment Flow et les membres de son équipe commerciale ont accès aux données.
            Prestataires techniques : Vercel (hébergement de l&apos;application), Supabase (base de données,
            hébergée dans l&apos;Union européenne), Meta Platforms (API Instagram et Facebook), TikTok et Google (YouTube) pour la publication de nos propres vidéos, Anthropic ou Google (analyse
            d&apos;images de nos propres vidéos pour rédiger leurs légendes). Certains de ces prestataires
            peuvent traiter des données hors de l&apos;Union européenne, dans le cadre des garanties prévues
            par le RGPD (clauses contractuelles types ou décision d&apos;adéquation).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">6. Durée de conservation</h2>
          <p>
            Les statistiques de nos contenus sont conservées tant que le compte est actif. Les données
            d&apos;une personne ayant commenté ou écrit sans donner suite sont supprimées au plus tard 3 ans
            après le dernier contact. Les vidéos en attente de publication sont supprimées dès leur publication.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">7. Vos droits</h2>
          <p>
            Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification, d&apos;effacement,
            de limitation, d&apos;opposition et de portabilité de vos données. Pour les exercer, écrivez à{' '}
            <a className="text-primary-600 underline" href="mailto:lomig.guegueniat@gmail.com">lomig.guegueniat@gmail.com</a>.
            La procédure de suppression est détaillée sur la page{' '}
            <Link className="text-primary-600 underline" href="/suppression-donnees">Suppression des données</Link>.
            Vous pouvez aussi introduire une réclamation auprès de la CNIL (www.cnil.fr).
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">8. Sécurité</h2>
          <p>
            L&apos;accès à l&apos;outil est réservé aux personnes authentifiées de l&apos;équipe. Les échanges sont
            chiffrés (HTTPS) et les jetons d&apos;accès à l&apos;API Instagram sont stockés côté serveur uniquement.
          </p>
        </section>
      </article>
    </main>
  );
}
