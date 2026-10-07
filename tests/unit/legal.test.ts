import { createTranslator } from "next-intl";
import { describe, expect, it } from "vitest";
import { LEGAL_ENV, LEGAL_MISSING, LEGAL_TERMS_VERSION, legalInfo } from "@/config/legal";
import { flattenMessages } from "@/i18n/check-messages";
import { MESSAGES } from "@/i18n/messages";
import { LOCALES } from "@/i18n/routing";
import { LEGAL_PAGE_KEYS, LEGAL_PAGES, legalPageFromSlug, legalPath } from "@/lib/legal/pages";

const TAGS = ["strong", "privacy", "terms", "ai", "export", "delete", "cnil"] as const;

/** Rend un message `legal.*` en texte, comme la page, avec les valeurs fournies. */
function render(locale: (typeof LOCALES)[number], key: string, values: Record<string, unknown>) {
  const t = createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "legal",
    onError: (error) => {
      throw error;
    },
  });
  const markup = t.markup as unknown as (key: string, values: Record<string, unknown>) => string;
  const tags = Object.fromEntries(TAGS.map((tag) => [tag, (chunks: string) => chunks]));
  return markup(key, { ...values, ...tags });
}

describe("informations légales (LEGAL_*)", () => {
  it("une valeur absente ou vide s'affiche comme un tiret neutre", () => {
    const info = legalInfo({ LEGAL_SIREN: "   " });
    for (const field of Object.keys(LEGAL_ENV)) {
      expect(info[field as keyof typeof info]).toBe(LEGAL_MISSING);
    }
  });

  it("lit chaque champ dans sa variable, espaces normalisés", () => {
    const info = legalInfo({
      LEGAL_PUBLISHER_NAME: " DD TECH CONSULT ",
      LEGAL_ADDRESS: "1 rue Exemple\n92300  Levallois-Perret",
      LEGAL_HOST_NAME: "Hébergeur SAS",
    });
    expect(info.publisher).toBe("DD TECH CONSULT");
    expect(info.address).toBe("1 rue Exemple 92300 Levallois-Perret");
    expect(info.hostName).toBe("Hébergeur SAS");
    expect(info.director).toBe(LEGAL_MISSING);
  });

  it("la version des conditions est une date ISO", () => {
    expect(LEGAL_TERMS_VERSION).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("pages légales", () => {
  it("chemins et slugs", () => {
    expect(legalPath("privacy", "cookies")).toBe("/legal/confidentialite#cookies");
    for (const key of LEGAL_PAGE_KEYS) expect(legalPageFromSlug(LEGAL_PAGES[key])).toBe(key);
    expect(legalPageFromSlug("inconnue")).toBeNull();
  });

  it("chaque page a un titre, une introduction et des sections titrées non vides", () => {
    for (const locale of LOCALES) {
      const pages = MESSAGES[locale].legal.pages as Record<
        string,
        { title: string; intro: string; sections: Record<string, Record<string, unknown>> }
      >;
      expect(Object.keys(pages).sort()).toEqual([...LEGAL_PAGE_KEYS].sort());
      for (const page of Object.values(pages)) {
        expect(page.title && page.intro).toBeTruthy();
        expect(Object.keys(page.sections).length).toBeGreaterThan(0);
        for (const section of Object.values(page.sections)) {
          expect(Object.keys(section).sort()).toEqual(["content", "title"]);
        }
      }
    }
  });

  it("sans aucune variable LEGAL_*, aucun texte à compléter ni variable non remplacée", () => {
    for (const locale of LOCALES) {
      const keys = [...flattenMessages(MESSAGES[locale].legal).keys()];
      for (const payments of ["simulator", "stripe"]) {
        const values = {
          ...legalInfo({}),
          payments,
          cardDays: 30,
          handoverDays: 30,
          postingDays: 30,
          date: "7 octobre 2026",
        };
        for (const key of keys) {
          const text = render(locale, key, values);
          expect(text, `${locale} ${key}`).not.toMatch(
            /\bTODO\b|\bTBD\b|XXX|à compléter|undefined|[{}<>]/,
          );
        }
      }
    }
  });

  it("les textes citent les valeurs de l'environnement quand elles sont renseignées", () => {
    const values = {
      ...legalInfo({ LEGAL_PUBLISHER_NAME: "DD TECH CONSULT", LEGAL_DIRECTOR: "Jeanne Exemple" }),
      payments: "simulator",
    };
    expect(render("fr", "pages.notice.sections.publisher.content.list.name", values)).toBe(
      "Raison sociale : DD TECH CONSULT",
    );
    expect(render("en", "pages.notice.sections.director.content.p1", values)).toBe(
      "Jeanne Exemple",
    );
    expect(render("fr", "pages.notice.sections.host.content.list.name", values)).toBe(
      `Nom : ${LEGAL_MISSING}`,
    );
  });
});
