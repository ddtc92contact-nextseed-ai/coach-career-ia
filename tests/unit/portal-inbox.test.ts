import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/routing";
import { channelFor, QUOTA_CHANNELS } from "@/lib/contact/channel";
import { portalContactEmail } from "@/lib/employer/email";
import { threadStatus } from "@/lib/employer/thread";

const none = { applyEmail: null, applyUrl: null };

describe("canal d'une prise de contact", () => {
  it("offre publiée directement → messagerie de l'espace entreprise (PORTAL)", () => {
    expect(channelFor({ ...none, source: "direct", orgId: "org_1" })).toBe("PORTAL");
    // Même si une adresse traînait sur l'offre : jamais d'e-mail pour une offre directe.
    expect(
      channelFor({ source: "direct", orgId: "org_1", applyEmail: "rh@x.test", applyUrl: null }),
    ).toBe("PORTAL");
    // Offre directe sans organisation (incohérente) : aucun canal.
    expect(channelFor({ ...none, source: "direct", orgId: null })).toBeNull();
  });

  it("autres sources → e-mail en priorité, puis page « Postuler »", () => {
    const base = { source: "greenhouse", orgId: null };
    expect(channelFor({ ...base, applyEmail: "rh@x.test", applyUrl: "https://x.test" })).toBe(
      "EMAIL",
    );
    expect(channelFor({ ...base, applyEmail: null, applyUrl: "https://x.test" })).toBe("APPLY_URL");
    expect(channelFor({ ...base, ...none })).toBeNull();
    expect(channelFor({ applyEmail: "rh@x.test", applyUrl: null })).toBe("EMAIL");
  });

  it("les envois e-mail et messagerie partagent le quota quotidien", () => {
    expect([...QUOTA_CHANNELS].sort()).toEqual(["EMAIL", "PORTAL"]);
  });
});

describe("statut d'un fil côté entreprise", () => {
  const at = new Date("2026-10-07T12:00:00Z");
  it("nouveau → lu → répondu → clos", () => {
    expect(threadStatus({ orgReadAt: null, orgClosedAt: null, replies: 0 })).toBe("NEW");
    expect(threadStatus({ orgReadAt: at, orgClosedAt: null, replies: 0 })).toBe("READ");
    expect(threadStatus({ orgReadAt: at, orgClosedAt: null, replies: 2 })).toBe("REPLIED");
    expect(threadStatus({ orgReadAt: at, orgClosedAt: at, replies: 2 })).toBe("CLOSED");
  });
});

describe("notification de candidature anonyme aux membres", () => {
  it("dans chaque langue : intitulé de l'offre et lien seulement", () => {
    for (const locale of LOCALES) {
      const mail = portalContactEmail(locale, {
        title: "Data engineer <senior>",
        url: "https://app.test/fr/entreprise/messages/c1",
      });
      expect(mail.subject).toContain("Data engineer <senior>");
      expect(mail.text).toContain("https://app.test/fr/entreprise/messages/c1");
      expect(mail.html).toContain("Data engineer &#60;senior&#62;");
      expect(mail.html).not.toContain("<senior>");
    }
    const fr = portalContactEmail("fr", { title: "Data engineer", url: "https://app.test/x" });
    expect(fr.subject).toBe("Vous avez reçu une candidature anonyme pour Data engineer");
  });
});
