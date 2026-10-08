"use client";

import { useTranslations } from "next-intl";
import { Icon } from "@/components/icons";
import { useShell } from "@/components/shell/app-shell";
import { Link } from "@/i18n/navigation";
import { employerForExperience } from "@/lib/vault/identity";
import { useVault } from "./vault-provider";

/**
 * Nom réel de l'employeur d'une expérience, joint dans le navigateur sur
 * l'identifiant d'expérience. Rien n'est rendu tant que le coffre est
 * verrouillé (ni dans le HTML serveur, ni côté client).
 */
export function VaultEmployerName({ experienceId }: { experienceId: string }) {
  const t = useTranslations("identity");
  const { identity } = useVault();
  const name = employerForExperience(identity, experienceId);
  if (!name) return null;
  return (
    <p className="text-ink mt-1 flex items-center gap-1.5 text-sm">
      <LockIcon open />
      <span className="sr-only">{t("employerLabel")}</span>
      <span className="font-medium break-words">{name}</span>
    </p>
  );
}

/**
 * État du coffre dans le menu latéral : coffre déverrouillé, avec verrouillage
 * en un clic. En mode rail, seul le bouton (cadenas) reste visible.
 */
export function VaultStatusBadge() {
  const t = useTranslations("identity");
  const { status, lock } = useVault();
  const { collapsed } = useShell();
  if (status !== "unlocked") return null;
  return (
    <div
      className={`bg-signal/10 ring-signal/30 flex items-center gap-2 rounded-xl py-1 pr-1 pl-3 ring-1 ring-inset ${
        collapsed ? "lg:justify-center lg:p-0 lg:ring-0" : ""
      }`}
    >
      <Link
        href="/app/identite"
        className={`text-signal flex min-h-9 min-w-0 flex-1 items-center gap-2 text-sm font-medium ${
          collapsed ? "lg:hidden" : ""
        }`}
      >
        <Icon name="unlock" className="size-4 shrink-0" />
        <span className="min-w-0 py-1 leading-snug break-words hyphens-auto">
          {t("badge.unlocked")}
        </span>
      </Link>
      <button
        type="button"
        onClick={lock}
        title={t("lock")}
        className={`text-on-night hover:bg-night-raised inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-sm font-medium ${
          collapsed ? "lg:size-11 lg:justify-center lg:px-0" : ""
        }`}
      >
        <Icon name="lock" className={`hidden size-5 ${collapsed ? "lg:block" : ""}`} />
        <span className={collapsed ? "lg:sr-only" : ""}>{t("lock")}</span>
      </button>
    </div>
  );
}

export function LockIcon({ open = false }: { open?: boolean }) {
  return (
    <svg aria-hidden viewBox="0 0 20 20" className="size-3.5 shrink-0" fill="currentColor">
      {open ? (
        <path d="M14 7V6a4 4 0 1 0-8 0h2a2 2 0 1 1 4 0v1H5a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-1Z" />
      ) : (
        <path d="M6 7V6a4 4 0 1 1 8 0v1h1a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1Zm2 0h4V6a2 2 0 1 0-4 0v1Z" />
      )}
    </svg>
  );
}
