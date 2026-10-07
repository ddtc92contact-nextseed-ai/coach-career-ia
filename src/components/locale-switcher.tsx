"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useTransition } from "react";
import { saveLocalePreference } from "@/app/[locale]/app/actions";
import { usePathname, useRouter } from "@/i18n/navigation";
import { isAppLocale, LOCALE_NAMES, LOCALES } from "@/i18n/routing";

/**
 * Sélecteur de langue. Avec `persist`, la langue choisie est aussi enregistrée
 * comme préférence du compte (e-mails, textes générés par l'IA).
 */
export function LocaleSwitcher({
  persist = false,
  showLabel = false,
}: {
  persist?: boolean;
  showLabel?: boolean;
}) {
  const t = useTranslations("localeSwitcher");
  const locale = useLocale();
  const pathname = usePathname();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const id = useId();

  function onChange(next: string) {
    if (!isAppLocale(next) || next === locale) return;
    startTransition(async () => {
      if (persist) await saveLocalePreference(next);
      router.replace(`${pathname}${window.location.search}`, { locale: next });
    });
  }

  return (
    <div className="flex items-center gap-2">
      <label htmlFor={id} className={showLabel ? "text-sm font-medium text-stone-700" : "sr-only"}>
        {t("label")}
      </label>
      <select
        id={id}
        value={locale}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        className="rounded-lg border border-stone-300 bg-white py-1.5 pr-8 pl-2 text-sm disabled:opacity-60"
      >
        {LOCALES.map((code) => (
          <option key={code} value={code} lang={code}>
            {LOCALE_NAMES[code]}
          </option>
        ))}
      </select>
    </div>
  );
}
