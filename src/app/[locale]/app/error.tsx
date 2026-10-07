"use client";

import { ErrorView } from "@/components/error-view";

/** Erreur dans l'espace candidat : l'en-tête et la navigation restent affichés. */
export default function AppError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return <ErrorView retry={retry} homeHref="/app" />;
}
