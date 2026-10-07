import type { Metadata } from "next";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Ma mémoire de carrière" };

export default async function CareerMemoryPage() {
  await requireUser();
  return (
    <>
      <PageTitle
        title="Ma mémoire de carrière"
        intro="Vos réalisations concrètes, chacune appuyée par une preuve. C'est la base de votre profil anonymisé."
      />
      <EmptyState
        title="Bientôt disponible"
        text="L'éditeur de mémoire de carrière arrive prochainement. Vous pourrez y consigner projets, résultats et compétences démontrées."
      />
    </>
  );
}
