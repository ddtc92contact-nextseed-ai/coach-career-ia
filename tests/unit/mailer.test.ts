import { describe, expect, it } from "vitest";
import { magicLinkEmail } from "@/lib/auth/mailer";

describe("magicLinkEmail", () => {
  it("rédige un e-mail en français contenant le lien échappé", () => {
    const url = "https://coach.example/api/auth/callback/email?token=a&email=b";
    const mail = magicLinkEmail(url);
    expect(mail.subject).toContain("connexion");
    expect(mail.text).toContain(url);
    expect(mail.html).toContain("token=a&#38;email=b");
    expect(mail.html).toContain('lang="fr"');
  });
});
