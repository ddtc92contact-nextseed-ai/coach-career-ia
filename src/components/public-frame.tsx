import type { ReactNode } from "react";
import { Icon } from "@/components/icons";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { Logo } from "@/components/logo";

/**
 * Cadre des pages publiques ouvertes par un lien à jeton (carte anonyme,
 * réponse d'une entreprise, profil révélé) : barre du haut, contenu centré et
 * note de confidentialité. Aucune donnée n'y est ajoutée : seul le contenu
 * passé en `children` s'affiche.
 */
export function PublicFrame({
  eyebrow,
  title,
  lead,
  notice,
  titleHidden = false,
  children,
}: {
  eyebrow?: string;
  title: string;
  lead?: ReactNode;
  /** Note de bas de page (confidentialité, échéance du lien). */
  notice?: ReactNode;
  /** Titre lu par les lecteurs d'écran seulement (la carte porte son propre titre). */
  titleHidden?: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-line bg-surface border-b">
        <div className="mx-auto flex h-[4.5rem] max-w-3xl items-center justify-between gap-3 px-4 sm:px-6">
          <Logo />
          <LocaleSwitcher />
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 text-[1.0625rem] sm:px-6 sm:py-14">
        {titleHidden ? (
          <h1 className="sr-only">{title}</h1>
        ) : (
          <div className="mb-8">
            {eyebrow ? (
              <p className="text-brand-ink mb-2 text-[0.9375rem] font-semibold tracking-wide uppercase">
                {eyebrow}
              </p>
            ) : null}
            <h1 className="text-3xl font-bold tracking-tight text-balance hyphens-auto sm:text-4xl">
              {title}
            </h1>
            {lead ? <div className="text-ink-muted mt-3 text-lg text-pretty">{lead}</div> : null}
          </div>
        )}
        {children}
        {notice ? (
          <p className="text-ink-muted mt-10 flex items-start gap-2 text-sm">
            <Icon name="lock" className="mt-0.5 size-4 shrink-0" />
            <span>{notice}</span>
          </p>
        ) : null}
      </main>
    </div>
  );
}
