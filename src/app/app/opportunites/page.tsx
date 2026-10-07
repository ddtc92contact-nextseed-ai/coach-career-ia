import type { Metadata } from "next";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Opportunités" };

export default async function OpportunitiesPage() {
  await requireUser();
  return (
    <>
      <PageTitle
        title="Opportunités"
        intro="Uniquement des offres qui respectent vos garde-fous, avec l'explication de chaque correspondance."
      />
      <EmptyState
        title="Aucune opportunité pour l'instant"
        text="Dès que votre mémoire de carrière et vos garde-fous seront renseignés, votre agent commencera à vous proposer des offres qualifiées."
      />
    </>
  );
}
