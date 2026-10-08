"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { useVault } from "@/components/vault/vault-provider";

/**
 * État du coffre en grand, dans l'en-tête de « Mon identité » : déverrouillé
 * (signal), verrouillé, ou pas encore créé. Annoncé aux lecteurs d'écran à
 * chaque changement (verrouillage automatique compris).
 */
export function VaultState() {
  const t = useTranslations("identity.state");
  const { status } = useVault();
  if (status === "loading" || status === "error") return null;
  const state = status === "unlocked" ? "unlocked" : status === "none" ? "none" : "locked";
  return (
    <p
      role="status"
      className={`inline-flex items-center gap-2.5 rounded-full px-4 py-2.5 font-semibold ring-1 ring-inset ${
        state === "unlocked"
          ? "bg-signal text-night ring-signal"
          : "bg-night-raised text-on-night ring-night-line"
      }`}
    >
      <Icon name={state === "unlocked" ? "unlock" : "lock"} className="size-5" />
      {t(state)}
    </p>
  );
}
