import { describe, expect, it } from "vitest";
import { magicLinkEmail, magicLinkLocale } from "@/lib/auth/mailer";

const url = (callbackUrl: string) =>
  `https://coach.example/api/auth/callback/email?callbackUrl=${encodeURIComponent(callbackUrl)}&token=a&email=b`;

describe("magicLinkEmail", () => {
  it("rédige par défaut un e-mail en français contenant le lien échappé", () => {
    const link = "https://coach.example/api/auth/callback/email?token=a&email=b";
    const mail = magicLinkEmail(link);
    expect(mail.subject).toContain("connexion");
    expect(mail.text).toContain(link);
    expect(mail.html).toContain("token=a&#38;email=b");
    expect(mail.html).toContain('lang="fr"');
  });

  it.each([
    ["en", "sign"],
    ["es", "enlace"],
    ["it", "link"],
    ["de", "Link"],
    ["nl", "link"],
  ] as const)("rédige l'e-mail en %s", (locale, word) => {
    const mail = magicLinkEmail(url(`/${locale}/app`), locale);
    expect(mail.html).toContain(`lang="${locale}"`);
    expect(`${mail.subject} ${mail.text}`.toLowerCase()).toContain(word.toLowerCase());
    expect(mail.subject).not.toBe(magicLinkEmail(url("/fr/app"), "fr").subject);
  });
});

describe("magicLinkLocale", () => {
  it("lit la langue de la destination du lien", () => {
    expect(magicLinkLocale(url("/en/app/memoire"))).toBe("en");
    expect(magicLinkLocale(url("https://coach.example/de/app"))).toBe("de");
  });

  it("ignore une destination sans langue reconnue", () => {
    expect(magicLinkLocale(url("/app"))).toBeUndefined();
    expect(magicLinkLocale(url("/pt/app"))).toBeUndefined();
    expect(magicLinkLocale("pas une url")).toBeUndefined();
  });
});
