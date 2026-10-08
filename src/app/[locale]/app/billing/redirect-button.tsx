"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/button";

/** Bouton d'un formulaire qui redirige vers Stripe : désactivé pendant l'envoi. */
export function RedirectButton({
  label,
  pendingLabel,
  primary = false,
  signal = false,
}: {
  label: string;
  pendingLabel: string;
  primary?: boolean;
  /** Appel à l'action sur fond nuit (offre Premium). */
  signal?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`${buttonClass(signal ? "signal" : primary ? "primary" : "secondary", signal ? "lg" : "md")} w-full sm:w-auto`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
