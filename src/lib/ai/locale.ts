import type { AppLocale } from "@/i18n/routing";

/** Nom anglais de chaque langue, pour les consignes données au modèle. */
const LANGUAGE_NAMES: Record<AppLocale, string> = {
  fr: "French",
  en: "English",
  es: "Spanish",
  it: "Italian",
  de: "German",
  nl: "Dutch",
};

export function languageName(locale: AppLocale): string {
  return LANGUAGE_NAMES[locale];
}

/**
 * Consigne de langue des textes générés : ceux-ci suivent la langue de
 * l'utilisateur (`getUserLocale()`), quelle que soit la langue du document source.
 */
export function languageInstruction(locale: AppLocale): string {
  const language = LANGUAGE_NAMES[locale];
  return `Write every human-readable text value in ${language}, even when the source document is in another language. Keep technology, tool and product names as they are.`;
}
