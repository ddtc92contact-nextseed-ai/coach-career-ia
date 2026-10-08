"use client";

import { useFormStatus } from "react-dom";
import { buttonClass } from "@/components/button";

/** Bouton d'un formulaire d'action serveur (paiement, soumission…) : désactivé pendant l'envoi. */
export function PendingButton({
  label,
  pendingLabel = "…",
  variant = "secondary",
  name,
  value,
}: {
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost";
  name?: string;
  value?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending || undefined}
      className={`${buttonClass(variant, "lg")} w-full sm:w-auto`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
