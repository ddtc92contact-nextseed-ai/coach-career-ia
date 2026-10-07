"use client";

import { useFormStatus } from "react-dom";

/** Bouton d'un formulaire qui redirige vers Stripe : désactivé pendant l'envoi. */
export function RedirectButton({
  label,
  pendingLabel,
  primary = false,
}: {
  label: string;
  pendingLabel: string;
  primary?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending || undefined}
      className={`w-full rounded-lg px-5 py-2.5 text-sm font-medium disabled:opacity-60 sm:w-auto ${
        primary
          ? "bg-stone-900 text-white hover:bg-stone-700"
          : "border border-stone-300 bg-white hover:bg-stone-100"
      }`}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
