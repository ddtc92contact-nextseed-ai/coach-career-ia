"use client";

import { useTranslations } from "next-intl";
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
    <p className="mt-1 flex items-center gap-1.5 text-sm text-stone-800">
      <LockIcon open />
      <span className="sr-only">{t("employerLabel")}</span>
      <span className="font-medium break-words">{name}</span>
    </p>
  );
}

/** Indicateur d'en-tête : coffre déverrouillé, avec verrouillage en un clic. */
export function VaultStatusBadge() {
  const t = useTranslations("identity");
  const { status, lock } = useVault();
  if (status !== "unlocked") return null;
  return (
    <span className="bg-brand-50 text-brand-800 ring-brand-100 inline-flex items-center gap-1 rounded-full py-0.5 pr-1 pl-2 text-xs font-medium ring-1 ring-inset">
      <LockIcon open />
      <Link href="/app/identite" className="hidden whitespace-nowrap sm:inline">
        {t("badge.unlocked")}
      </Link>
      <button
        type="button"
        onClick={lock}
        className="rounded-full bg-white px-2 py-0.5 whitespace-nowrap ring-1 ring-stone-200 hover:bg-stone-50"
      >
        {t("lock")}
      </button>
    </span>
  );
}

/** Déconnexion : la clé du coffre est effacée avant l'envoi du formulaire. */
export function LogoutButton({ action, label }: { action: () => Promise<void>; label: string }) {
  const { lock } = useVault();
  return (
    <form action={action} onSubmit={lock}>
      <button
        type="submit"
        className="rounded-lg border border-stone-300 px-3 py-1.5 text-sm font-medium whitespace-nowrap hover:bg-stone-100"
      >
        {label}
      </button>
    </form>
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
