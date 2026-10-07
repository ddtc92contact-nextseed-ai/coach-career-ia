import type { Formats } from "next-intl";

/** Fuseau horaire par défaut des dates affichées. */
export const TIME_ZONE = "Europe/Paris";

/**
 * Formats nommés, utilisables avec `format.number(v, "salary")` ou
 * `format.dateTime(d, "month")`. Le rendu dépend de la langue :
 * `45 000 €` en français, `€45,000` en anglais.
 */
export const formats = {
  number: {
    salary: { style: "currency", currency: "EUR", maximumFractionDigits: 0 },
    percent: { style: "percent", maximumFractionDigits: 0 },
  },
  dateTime: {
    month: { year: "numeric", month: "long", timeZone: "UTC" },
    short: { day: "numeric", month: "short", year: "numeric" },
  },
} satisfies Formats;
