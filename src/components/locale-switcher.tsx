"use client";

import { useLocale, useTranslations } from "next-intl";
import { useId, useTransition } from "react";
import { saveLocalePreference } from "@/app/[locale]/app/actions";
import { usePathname, useRouter } from "@/i18n/navigation";
import { isAppLocale, LOCALE_NAMES, LOCALES } from "@/i18n/routing";

const TONES = {
  default: "border-line-strong bg-surface text-ink hover:bg-subtle shadow-xs py-1.5",
  night:
    "border-night-line bg-night-raised text-on-night hover:border-on-night-muted min-h-11 w-full scheme-dark",
} as const;

/**
 * Sélecteur de langue. Avec `persist`, la langue choisie est aussi enregistrée
 * comme préférence du compte (e-mails, textes générés par l'IA). `tone="night"`
 * pour le menu latéral.
 */
export function LocaleSwitcher({
  persist = false,
  showLabel = false,
  tone = "default",
}: {
  persist?: boolean;
  showLabel?: boolean;
  tone?: keyof typeof TONES;
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
    <div className={`flex min-w-0 items-center gap-2 ${tone === "night" ? "w-full" : ""}`}>
      <label htmlFor={id} className={showLabel ? "text-ink-muted text-sm font-medium" : "sr-only"}>
        {t("label")}
      </label>
      <select
        id={id}
        value={locale}
        disabled={pending}
        onChange={(event) => onChange(event.target.value)}
        className={`min-w-0 rounded-lg border pr-8 pl-2 text-sm text-ellipsis disabled:opacity-60 ${TONES[tone]}`}
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
