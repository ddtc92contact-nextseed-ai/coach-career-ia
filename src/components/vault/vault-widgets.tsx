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

/**
 * Indicateur d'en-tête : coffre déverrouillé, avec verrouillage en un clic.
 * Sur téléphone, seul le bouton (cadenas) est montré pour tenir à côté du
 * sélecteur de langue et de la déconnexion.
 */
export function VaultStatusBadge() {
  const t = useTranslations("identity");
  const { status, lock } = useVault();
  if (status !== "unlocked") return null;
  return (
    <span className="sm:bg-brand-50 text-brand-800 sm:ring-brand-100 inline-flex shrink-0 items-center gap-1 rounded-full text-xs font-medium sm:py-0.5 sm:pr-1 sm:pl-2 sm:ring-1 sm:ring-inset">
      <span className="hidden sm:contents">
        <LockIcon open />
      </span>
      <Link href="/app/identite" className="hidden whitespace-nowrap sm:inline">
        {t("badge.unlocked")}
      </Link>
      <button
        type="button"
        onClick={lock}
        title={t("lock")}
        className="bg-brand-50 ring-brand-100 inline-flex items-center rounded-full p-2 ring-1 hover:bg-stone-50 sm:bg-white sm:px-2 sm:py-0.5 sm:ring-stone-200"
      >
        <span className="sm:hidden">
          <LockIcon />
        </span>
        <span className="sr-only whitespace-nowrap sm:not-sr-only">{t("lock")}</span>
      </button>
    </span>
  );
}

/** Déconnexion : la clé du coffre est effacée avant l'envoi du formulaire. */
export function LogoutButton({ action, label }: { action: () => Promise<void>; label: string }) {
  const { lock } = useVault();
  return (
    <form action={action} onSubmit={lock} className="shrink-0">
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
