import type { Metadata } from "next";
import { EmptyState, PageTitle } from "@/components/empty-state";
import { requireUser } from "@/lib/auth/session";

export const metadata: Metadata = { title: "Mes garde-fous" };

export default async function GuardRailsPage() {
  await requireUser();
  return (
    <>
      <PageTitle
        title="Mes garde-fous"
        intro="Les conditions non négociables qu'une offre doit respecter pour arriver jusqu'à vous."
      />
      <EmptyState
        title="Bientôt disponible"
        text="Vous pourrez bientôt définir votre salaire plancher, vos préférences de télétravail, les secteurs exclus et plus encore."
      />
    </>
  );
}
