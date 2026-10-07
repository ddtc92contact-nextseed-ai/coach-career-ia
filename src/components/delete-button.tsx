"use client";

import { useTranslations } from "next-intl";
import { useTransition } from "react";

/** Bouton de suppression avec confirmation ; `action` est une action serveur liée. */
export function DeleteButton({
  action,
  confirmMessage,
  label,
  small = false,
}: {
  action: () => Promise<unknown>;
  confirmMessage: string;
  label?: string;
  small?: boolean;
}) {
  const t = useTranslations("common");
  const [pending, startTransition] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      onClick={() => {
        if (!window.confirm(confirmMessage)) return;
        startTransition(async () => {
          await action();
        });
      }}
      className={`rounded-lg border border-red-200 font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 ${
        small ? "px-2.5 py-1 text-sm" : "px-4 py-2.5"
      }`}
    >
      {pending ? t("deleting") : (label ?? t("delete"))}
    </button>
  );
}
