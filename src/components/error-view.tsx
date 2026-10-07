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
      <p className="mt-3 text-stone-600">{t("text")}</p>
      <div className="mt-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <button
          type="button"
          onClick={() => retry()}
          className="w-full rounded-lg bg-stone-900 px-5 py-2.5 font-medium text-white hover:bg-stone-700 sm:w-auto"
        >
          {t("retry")}
        </button>
        <Link href={homeHref} className="text-brand-700 text-sm underline underline-offset-4">
          {t("back")}
        </Link>
      </div>
    </div>
  );
}
