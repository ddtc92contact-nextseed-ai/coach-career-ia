"use client";

import { Card } from "@/components/card";
import { ErrorView } from "@/components/error-view";

/** Erreur dans l'espace candidat : l'en-tête et la navigation restent affichés. */
export default function AppError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <Card as="div" className="mx-auto mt-4 max-w-xl">
      <ErrorView retry={retry} homeHref="/app" />
    </Card>
  );
}
