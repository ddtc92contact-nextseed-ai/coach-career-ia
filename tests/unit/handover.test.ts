import { describe, expect, it } from "vitest";
import { LOCALES } from "@/i18n/routing";
import { handoverTtlDays, revealedCvPath, revealedPath } from "@/lib/handover/config";
import { handoverEmail } from "@/lib/handover/email";
import {
  buildReveal,
  emptySelection,
  isAllowedCv,
  isHttpUrl,
  previewIdentity,
  revealedFields,
  revealInput,
  safeFileName,
} from "@/lib/handover/schema";
import { identityData } from "@/lib/vault/identity";

const identity = identityData.parse({
  firstName: "Alice",
  lastName: "Testard",
  email: "alice@exemple.test",
  phone: "+33 6 12 34 56 78",
  employers: [
    { experienceId: "exp1", name: "Initech" },
    { experienceId: "exp2", name: "Globex" },
  ],
  schools: [{ name: "École Centrale" }],
  links: [
    { label: "LinkedIn", url: "https://www.linkedin.com/in/alice" },
    { label: "Blog", url: "https://alice.exemple.test" },
  ],
});

describe("levée d'anonymat : sélection des champs", () => {
  it("rien n'est révélé par défaut", () => {
    expect(buildReveal(identity, emptySelection())).toEqual({});
    expect(revealedFields({}, false)).toEqual([]);
  });

  it("seuls les champs cochés sont retenus, éléments de liste compris", () => {
    const reveal = buildReveal(identity, {
      ...emptySelection(),
      name: true,
      links: [0],
      employers: [1],
    });
    expect(reveal).toEqual({
      name: { firstName: "Alice", lastName: "Testard" },
      links: [{ label: "LinkedIn", url: "https://www.linkedin.com/in/alice" }],
      employers: [{ experienceId: "exp2", name: "Globex" }],
    });
    const serialized = JSON.stringify(reveal);
    for (const hidden of ["alice@exemple.test", "+33", "Initech", "Centrale", "alice.exemple"]) {
      expect(serialized).not.toContain(hidden);
    }
    expect(revealedFields(reveal, true)).toEqual(["name", "links", "employers", "cv"]);
  });

  it("validation serveur : champs inconnus, listes vides et nom vide refusés", () => {
    expect(revealInput.safeParse({ email: "a@b.c" }).success).toBe(true);
    expect(revealInput.safeParse({ email: "a@b.c", password: "x" }).success).toBe(false);
    expect(revealInput.safeParse({ links: [] }).success).toBe(false);
    expect(revealInput.safeParse({ name: { firstName: "", lastName: " " } }).success).toBe(false);
    expect(revealInput.safeParse({ phone: "x".repeat(41) }).success).toBe(false);
    expect(revealInput.safeParse({ employers: { not: "x" } }).success).toBe(false);
  });

  it("aperçu : intitulés de poste joints aux employeurs, CV par son nom", () => {
    const reveal = buildReveal(identity, { ...emptySelection(), employers: [0, 1] });
    expect(
      previewIdentity(
        reveal,
        { exp1: "Ingénieure data" },
        { name: "cv.pdf", type: "application/pdf", size: 3 },
      ),
    ).toEqual({
      employers: [
        { name: "Initech", role: "Ingénieure data" },
        { name: "Globex", role: null },
      ],
      cv: { name: "cv.pdf", type: "application/pdf", size: 3 },
    });
  });

  it("CV : types et taille du coffre ; nom de fichier assaini", () => {
    expect(isAllowedCv({ size: 10, type: "application/pdf" })).toBe(true);
    expect(isAllowedCv({ size: 10, type: "text/html" })).toBe(false);
    expect(isAllowedCv({ size: 0, type: "application/pdf" })).toBe(false);
    expect(isAllowedCv({ size: 6 * 1024 * 1024, type: "application/pdf" })).toBe(false);
    expect(safeFileName("../../etc/passwd")).toBe("passwd");
    expect(safeFileName('C:\\Users\\a\\"cv"\n.pdf')).toBe("cv.pdf");
    expect(safeFileName("")).toBe("cv");
  });

  it("seuls les liens http(s) sont cliquables", () => {
    expect(isHttpUrl("https://x.test/a")).toBe(true);
    expect(isHttpUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("levée d'anonymat : configuration et e-mail", () => {
  it("durée de validité : 30 jours par défaut, bornée", () => {
    expect(handoverTtlDays({})).toBe(30);
    expect(handoverTtlDays({ HANDOVER_TTL_DAYS: "7" })).toBe(7);
    expect(handoverTtlDays({ HANDOVER_TTL_DAYS: "0" })).toBe(30);
    expect(handoverTtlDays({ HANDOVER_TTL_DAYS: "abc" })).toBe(30);
    const token = "a".repeat(43);
    expect(revealedPath("de", token)).toBe(`/de/r/${token}`);
    expect(revealedCvPath(token)).toBe(`/api/r/${token}/cv`);
  });

  it.each(LOCALES)(
    "e-mail (%s) : lien, expiration, mention de l'agent IA, aucune donnée d'identité",
    (locale) => {
      const url = `https://coach.exemple.test/${locale}/r/${"b".repeat(43)}`;
      const mail = handoverEmail(locale, {
        offerTitle: "Data engineer",
        url,
        expiresAt: new Date("2026-11-06T12:00:00Z"),
      });
      expect(mail.subject).toContain("Data engineer");
      expect(mail.text).toContain(url);
      expect(mail.html).toContain(url);
      expect(mail.text).toContain("Coach Career IA");
      expect(mail.text).toMatch(/2026/);
      expect(mail.headers?.["X-AI-Generated"]).toBeDefined();
    },
  );

  it("e-mail : intitulé de l'offre échappé en HTML", () => {
    const mail = handoverEmail("fr", {
      offerTitle: "<script>x</script>",
      url: "https://coach.exemple.test/fr/r/x",
      expiresAt: new Date(),
    });
    expect(mail.html).not.toContain("<script>");
  });
});
