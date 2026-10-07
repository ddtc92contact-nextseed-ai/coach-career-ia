import { describe, expect, it } from "vitest";
import { checkMessages, flattenMessages, messageArguments } from "@/i18n/check-messages";
import { MESSAGES } from "@/i18n/messages";
import { DEFAULT_LOCALE, LOCALES } from "@/i18n/routing";

describe("fichiers de traduction", () => {
  it("les 6 langues ont exactement les clés du français, avec des messages ICU cohérents", () => {
    const others = Object.fromEntries(
      LOCALES.filter((l) => l !== DEFAULT_LOCALE).map((l) => [l, MESSAGES[l]]),
    );
    expect(checkMessages(MESSAGES[DEFAULT_LOCALE], others)).toEqual([]);
  });

  it("les traductions ne sont pas de simples copies du français", () => {
    const fr = flattenMessages(MESSAGES.fr);
    for (const locale of LOCALES.filter((l) => l !== "fr")) {
      const messages = flattenMessages(MESSAGES[locale]);
      const identical = [...fr].filter(([key, value]) => messages.get(key) === value).length;
      // Quelques termes sont identiques d'une langue à l'autre (Freelance, Fintech, Senior…).
      expect(identical / fr.size, locale).toBeLessThan(0.15);
    }
  });
});

describe("checkMessages", () => {
  const source = {
    a: { b: "Bonjour {name}", c: "{count, plural, one {# preuve} other {# preuves}}" },
  };

  it("signale une clé manquante et une clé en trop", () => {
    expect(checkMessages(source, { en: { a: { b: "Hello {name}", d: "x" } } })).toEqual([
      "en : clé manquante « a.c »",
      "en : clé absente du français « a.d »",
    ]);
  });

  it("signale une variable perdue et un message ICU invalide", () => {
    const problems = checkMessages(source, {
      en: { a: { b: "Hello", c: "{count, plural, one {# proof}" } },
    });
    expect(problems).toHaveLength(2);
    expect(problems[0]).toContain("variables différentes pour « a.b »");
    expect(problems[1]).toContain("message ICU invalide pour « a.c »");
  });

  it("extrait variables et balises", () => {
    expect([...messageArguments("Hi {name}, <link>{count, number}</link>")]).toEqual([
      "name",
      "<link>",
      "count",
    ]);
  });
});
