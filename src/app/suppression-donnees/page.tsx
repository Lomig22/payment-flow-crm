import type { Metadata } from 'next';
import Link from 'next/link';

// Instructions de suppression des données : URL exigée par Meta (App Review).
export const metadata: Metadata = {
  title: 'Suppression des données — Payment Flow',
};

export default function SuppressionDonneesPage() {
  return (
    <main className="min-h-screen bg-white">
      <article className="max-w-3xl mx-auto px-4 py-12 text-gray-800 leading-relaxed space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Suppression de vos données</h1>
          <p className="text-sm text-gray-500">Payment Flow — Lomig Guégueniat, RCS Brest 944 989 599</p>
        </header>

        <p>
          Si vous avez commenté un contenu de notre compte Instagram, si vous nous avez écrit en message privé
          ou si vous nous avez transmis vos coordonnées, vous pouvez demander à tout moment la suppression
          de toutes les données vous concernant.
        </p>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">Comment faire</h2>
          <ol className="list-decimal pl-5 space-y-1">
            <li>
              Envoyez un e-mail à{' '}
              <a className="text-primary-600 underline" href="mailto:lomig.guegueniat@gmail.com?subject=Suppression%20de%20mes%20donn%C3%A9es">
                lomig.guegueniat@gmail.com
              </a>{' '}
              avec pour objet « Suppression de mes données ».
            </li>
            <li>Indiquez votre nom d&apos;utilisateur Instagram, et/ou l&apos;e-mail ou le téléphone que vous nous avez communiqué.</li>
            <li>
              Nous supprimons vos données (commentaires, messages, fiche contact) sous 30 jours au plus tard
              et vous confirmons la suppression par e-mail.
            </li>
          </ol>
        </section>

        <p>
          Vous pouvez aussi retirer à tout moment l&apos;accès d&apos;une application à votre compte depuis
          Instagram : Paramètres → Sécurité → Applications et sites web.
        </p>

        <p className="text-sm text-gray-500">
          Voir aussi notre <Link className="text-primary-600 underline" href="/confidentialite">politique de confidentialité</Link>.
        </p>
      </article>
    </main>
  );
}
