"use client";

import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";

/**
 * Message d'erreur inattendue (action serveur refusée, base indisponible…).
 * Le détail de l'erreur n'est jamais affiché ni journalisé côté navigateur :
 * il peut contenir des données personnelles.
 */
export function ErrorView({ retry, homeHref }: { retry: () => void; homeHref: string }) {
  const t = useTranslations("errorPage");
  return (
    <div role="alert" className="mx-auto max-w-md py-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-ink-muted mt-3">{t("text")}</p>
      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => retry()}
          className="bg-primary text-on-primary hover:bg-primary-hover w-full rounded-lg px-5 py-2.5 font-medium sm:w-auto"
        >
          {t("retry")}
        </button>
        <Link href={homeHref} className="text-brand-ink text-sm underline underline-offset-4">
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
