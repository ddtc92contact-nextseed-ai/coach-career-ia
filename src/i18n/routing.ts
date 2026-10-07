import { defineRouting } from "next-intl/routing";

/** Langues proposées. Le français est la langue source et la langue par défaut. */
export const LOCALES = ["fr", "en", "es", "it", "de", "nl"] as const;
export type AppLocale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: AppLocale = "fr";

/** Nom de chaque langue dans sa propre langue (sélecteur de langue). */
export const LOCALE_NAMES: Record<AppLocale, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
  it: "Italiano",
  de: "Deutsch",
  nl: "Nederlands",
};

export function isAppLocale(value: unknown): value is AppLocale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

/**
 * Routes préfixées par la langue (`/fr`, `/en`…), toujours. La langue d'une
 * URL sans préfixe est déduite du cookie `NEXT_LOCALE` puis d'Accept-Language.
 */
export const routing = defineRouting({
  locales: LOCALES,
  defaultLocale: DEFAULT_LOCALE,
  localePrefix: "always",
});

/** Retire le préfixe de langue d'un chemin : `/en/app/memoire` → `/app/memoire`. */
export function stripLocalePrefix(pathname: string): string {
  const match = /^\/([a-z]{2})(?=\/|$)/.exec(pathname);
  if (!match || !isAppLocale(match[1])) return pathname;
  return pathname.slice(match[0].length) || "/";
}
