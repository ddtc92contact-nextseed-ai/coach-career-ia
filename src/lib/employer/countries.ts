import { COUNTRIES } from "./schema";

/** Noms des pays proposés, dans la langue de l'interface (`Intl.DisplayNames`). */
export function countryNames(locale: string): Record<string, string> {
  const names = new Intl.DisplayNames([locale], { type: "region" });
  return Object.fromEntries(COUNTRIES.map((code) => [code, names.of(code) ?? code]));
}
