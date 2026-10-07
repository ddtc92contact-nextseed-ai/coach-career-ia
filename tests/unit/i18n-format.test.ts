import { createFormatter, createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { formats, TIME_ZONE } from "@/i18n/formats";
import { MESSAGES } from "@/i18n/messages";
import { isAppLocale, stripLocalePrefix, type AppLocale } from "@/i18n/routing";
import { localeAlternates } from "@/lib/i18n/metadata";

const formatter = (locale: AppLocale) => createFormatter({ locale, formats, timeZone: TIME_ZONE });
// Les espaces insécables (fine ou non) sont normalisés pour la comparaison.
const plain = (value: string) => value.replace(/[  ]/g, " ");

describe("formats localisés", () => {
  it("formate les salaires selon la langue", () => {
    expect(plain(formatter("fr").number(45000, "salary"))).toBe("45 000 €");
    expect(formatter("en").number(45000, "salary")).toBe("€45,000");
    expect(plain(formatter("de").number(45000, "salary"))).toBe("45.000 €");
    expect(plain(formatter("nl").number(45000, "salary"))).toBe("€ 45.000");
  });

  it("formate un mois selon la langue, sans décalage de fuseau", () => {
    const date = new Date("2024-03-01T00:00:00.000Z");
    expect(formatter("fr").dateTime(date, "month")).toBe("mars 2024");
    expect(formatter("en").dateTime(date, "month")).toBe("March 2024");
    expect(formatter("es").dateTime(date, "month")).toBe("marzo de 2024");
  });

  it("accorde les pluriels", () => {
    const fr = createTranslator({ locale: "fr", messages: MESSAGES.fr, namespace: "memory" });
    expect(fr("achievements.proofCount", { count: 0 })).toBe("Aucune preuve");
    expect(fr("achievements.proofCount", { count: 2 })).toBe("2 preuves");
    const en = createTranslator({ locale: "en", messages: MESSAGES.en, namespace: "memory" });
    expect(en("achievements.proofCount", { count: 1 })).toMatch(/^1 /);
  });
});

describe("routage par langue", () => {
  it("reconnaît les 6 langues", () => {
    expect(["fr", "en", "es", "it", "de", "nl"].every(isAppLocale)).toBe(true);
    expect(isAppLocale("pt")).toBe(false);
  });

  it("retire le préfixe de langue", () => {
    expect(stripLocalePrefix("/en/app/memoire")).toBe("/app/memoire");
    expect(stripLocalePrefix("/fr")).toBe("/");
    expect(stripLocalePrefix("/pt/app")).toBe("/pt/app");
    expect(stripLocalePrefix("/english")).toBe("/english");
  });

  it("produit les alternatives hreflang de chaque langue et x-default", () => {
    expect(localeAlternates("en", "/connexion")).toEqual({
      canonical: "/en/connexion",
      languages: {
        fr: "/fr/connexion",
        en: "/en/connexion",
        es: "/es/connexion",
        it: "/it/connexion",
        de: "/de/connexion",
        nl: "/nl/connexion",
        "x-default": "/fr/connexion",
      },
    });
    expect(localeAlternates("fr", "/")?.canonical).toBe("/fr");
  });
});
