import Link from "next/link";
import { PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";

const sections = [
  {
    href: "/app/memoire",
    title: "Ma mémoire de carrière",
    text: "Rassemblez vos réalisations et les preuves qui les appuient.",
  },
  {
    href: "/app/garde-fous",
    title: "Mes garde-fous",
    text: "Fixez les conditions qu'aucune offre ne doit enfreindre.",
  },
  {
    href: "/app/opportunites",
    title: "Opportunités",
    text: "Retrouvez ici les offres qualifiées par votre agent.",
  },
];

export default async function DashboardPage() {
  await requireUser();

  return (
    <>
      <PageTitle
        title="Bienvenue dans votre espace"
        intro="Votre agent de carrière se met en place. Commencez par votre mémoire de carrière et vos garde-fous : ce sont eux qui guideront la sélection des opportunités."
      />
      <div className="grid gap-4 sm:grid-cols-3">
        {sections.map((section) => (
          <Link
            key={section.href}
            href={section.href}
            className="group rounded-xl border border-stone-200 bg-white p-5 hover:border-stone-400"
          >
            <h2 className="font-semibold">{section.title}</h2>
            <p className="mt-2 text-sm text-stone-600">{section.text}</p>
            <p className="text-brand-700 mt-4 text-sm font-medium group-hover:underline">
              Ouvrir →
            </p>
          </Link>
        ))}
      </div>
    </>
  );
}
