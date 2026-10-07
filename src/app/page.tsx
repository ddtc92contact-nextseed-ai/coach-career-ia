import Link from "next/link";
import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

const pillars = [
  {
    title: "Anonyme par défaut",
    text: "Votre identité, vos coordonnées et votre employeur actuel sont stockés à part, chiffrés. Les recruteurs ne voient qu'un profil anonymisé, construit sur ce que vous savez faire.",
  },
  {
    title: "Des preuves, pas des promesses",
    text: "Votre mémoire de carrière rassemble des réalisations concrètes : projets livrés, résultats mesurés, compétences démontrées. Ce sont elles qui parlent pour vous.",
  },
  {
    title: "Vos garde-fous font le tri",
    text: "Salaire plancher, télétravail, secteurs exclus, temps de trajet : vous fixez des règles non négociables. Une offre qui en enfreint une n'arrive jamais jusqu'à vous.",
  },
  {
    title: "Vous gardez la main",
    text: "Rien ne part sans votre accord. Quand une opportunité vous intéresse, vous levez l'anonymat en un clic — et seulement pour ce recruteur-là.",
  },
];

const steps = [
  "Vous décrivez votre parcours avec des preuves vérifiables.",
  "Vous posez vos garde-fous, une fois pour toutes.",
  "L'agent analyse le marché et ne vous présente que des offres qualifiées.",
  "Vous décidez, offre par offre, de vous dévoiler ou non.",
];

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main>
        <section className="mx-auto max-w-6xl px-4 pt-16 pb-12 sm:px-6 sm:pt-24">
          <p className="text-brand-700 text-sm font-medium tracking-wide uppercase">
            Agent de carrière privé
          </p>
          <h1 className="mt-4 max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
            Ne cherchez plus d&apos;emploi. Laissez les bonnes opportunités venir à vous.
          </h1>
          <p className="mt-6 max-w-2xl text-lg text-pretty text-stone-600">
            Coach Career IA inverse la recherche d&apos;emploi : vous constituez une mémoire de
            carrière fondée sur des preuves, vous fixez vos conditions, et notre agent ne vous
            apporte que les offres qui les respectent. Sans exposer votre identité.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/connexion"
              className="rounded-lg bg-stone-900 px-5 py-3 text-center font-medium text-white hover:bg-stone-700"
            >
              Créer mon espace
            </Link>
            <a
              href="#principes"
              className="rounded-lg border border-stone-300 bg-white px-5 py-3 text-center font-medium hover:bg-stone-100"
            >
              Comprendre le principe
            </a>
          </div>
        </section>

        <section
          id="principes"
          aria-labelledby="principes-titre"
          className="border-y border-stone-200 bg-white"
        >
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <h2 id="principes-titre" className="text-2xl font-semibold tracking-tight">
              Quatre principes, aucun compromis
            </h2>
            <div className="mt-10 grid gap-6 sm:grid-cols-2">
              {pillars.map((pillar, index) => (
                <article
                  key={pillar.title}
                  className="rounded-xl border border-stone-200 bg-stone-50 p-6"
                >
                  <p className="text-brand-700 text-sm font-medium">0{index + 1}</p>
                  <h3 className="mt-2 text-lg font-semibold">{pillar.title}</h3>
                  <p className="mt-2 text-stone-600">{pillar.text}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section aria-labelledby="etapes-titre" className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
          <h2 id="etapes-titre" className="text-2xl font-semibold tracking-tight">
            Comment ça marche
          </h2>
          <ol className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {steps.map((step, index) => (
              <li key={step} className="flex gap-4 rounded-xl border border-stone-200 bg-white p-5">
                <span
                  aria-hidden="true"
                  className="bg-brand-50 text-brand-800 grid size-8 shrink-0 place-items-center rounded-full text-sm font-semibold"
                >
                  {index + 1}
                </span>
                <span className="text-stone-700">{step}</span>
              </li>
            ))}
          </ol>
          <div className="mt-12 rounded-2xl bg-stone-900 px-6 py-10 text-white sm:px-10">
            <h2 className="text-2xl font-semibold tracking-tight">
              Votre carrière, vos règles, votre rythme.
            </h2>
            <p className="mt-3 max-w-2xl text-stone-300">
              Connexion sans mot de passe, par lien envoyé à votre adresse e-mail. Aucune donnée
              n&apos;est partagée sans votre accord explicite.
            </p>
            <Link
              href="/connexion"
              className="mt-6 inline-block rounded-lg bg-white px-5 py-3 font-medium text-stone-900 hover:bg-stone-200"
            >
              Commencer
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
