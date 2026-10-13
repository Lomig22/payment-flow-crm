import type { Metadata } from 'next';
import Link from 'next/link';

// Conditions d'utilisation : URL exigée par TikTok et Google pour leurs apps de publication.
export const metadata: Metadata = {
  title: 'Conditions d\'utilisation — Payment Flow',
};

export default function ConditionsPage() {
  return (
    <main className="min-h-screen bg-white">
      <article className="max-w-3xl mx-auto px-4 py-12 text-gray-800 leading-relaxed space-y-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-bold text-gray-900">Conditions d&apos;utilisation</h1>
          <p className="text-sm text-gray-500">Payment Flow — Lomig Guégueniat, entrepreneur individuel, RCS Brest 944 989 599</p>
        </header>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">1. Objet</h2>
          <p>
            Payment Flow édite un outil interne de gestion de la relation client et de publication de contenus.
            Il sert exclusivement à publier les vidéos de Payment Flow sur ses propres comptes (Instagram, Page
            Facebook, YouTube, TikTok) et à en mesurer les performances. L&apos;outil n&apos;est pas proposé au public.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">2. Accès</h2>
          <p>
            L&apos;accès est réservé aux membres de l&apos;équipe Payment Flow disposant d&apos;un compte. Chaque
            utilisateur est responsable de la confidentialité de ses identifiants.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">3. Contenus publiés</h2>
          <p>
            Payment Flow publie uniquement des contenus dont elle détient les droits, dans le respect des règles
            de chaque plateforme (Instagram, Facebook, YouTube, TikTok). Les comptes connectés à l&apos;outil le sont
            par leur propriétaire, qui peut retirer cet accès à tout moment depuis les paramètres de la plateforme.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">4. Données personnelles</h2>
          <p>
            Le traitement des données est décrit dans la{' '}
            <Link className="text-primary-600 underline" href="/confidentialite">politique de confidentialité</Link>.
          </p>
        </section>

        <section className="space-y-2">
          <h2 className="text-lg font-semibold text-gray-900">5. Contact</h2>
          <p>
            Penn An Neac&apos;h Rozegad, 29470 Plougastel-Daoulas, France —{' '}
            <a className="text-primary-600 underline" href="mailto:lomig.guegueniat@gmail.com">lomig.guegueniat@gmail.com</a>.
            Droit applicable : droit français.
          </p>
        </section>
      </article>
    </main>
  );
}
