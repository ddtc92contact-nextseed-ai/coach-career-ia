import type { Metadata } from "next";
import { LOCALES, DEFAULT_LOCALE, type AppLocale } from "@/i18n/routing";

/** URL publique de base (absolue) pour les liens canoniques et `hreflang`. */
export function siteUrl(): URL {
  return new URL(process.env.AUTH_URL ?? "http://localhost:3000");
}

/**
 * Lien canonique et alternatives `hreflang` d'une page publique, `path` étant
 * le chemin sans langue (`/`, `/connexion`…).
 */
export function localeAlternates(locale: AppLocale, path: string): Metadata["alternates"] {
  const suffix = path === "/" ? "" : path;
  const languages: Record<string, string> = {};
  for (const l of LOCALES) languages[l] = `/${l}${suffix}`;
  languages["x-default"] = `/${DEFAULT_LOCALE}${suffix}`;
  return { canonical: `/${locale}${suffix}`, languages };
}
