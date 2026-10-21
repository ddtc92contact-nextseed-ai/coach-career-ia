import { describe, expect, it } from "vitest";
import type { IdentityPayload } from "@/lib/import/shared";
import {
  emptyIdentity,
  hasVaultableIdentity,
  identityData,
  mergeImportedIdentity,
} from "@/lib/vault/identity";

const imported: IdentityPayload = {
  fullName: "Camille  Durand Martin",
  emails: ["camille@example.org", "autre@example.org"],
  phones: ["+33 6 12 34 56 78"],
  links: ["https://www.linkedin.com/in/camille", "github.com/camille"],
  employers: [
    { name: "Acme SA", experienceRef: "E1" },
    { name: "Globex", experienceRef: null },
  ],
  schools: [{ name: "Université de Lyon", degree: "Master" }],
  organizations: ["Client secret"],
};

describe("mergeImportedIdentity", () => {
  it("remplit un coffre vide avec les données repérées", () => {
    const result = mergeImportedIdentity(emptyIdentity(), imported, { E1: "exp-1" });
    expect(result).toEqual({
      firstName: "Camille",
      lastName: "Durand Martin",
      email: "camille@example.org",
      phone: "+33 6 12 34 56 78",
      employers: [
        { name: "Acme SA", experienceId: "exp-1" },
        { name: "Globex", experienceId: null },
      ],
      schools: [{ name: "Université de Lyon" }],
      links: [
        { label: "linkedin.com", url: "https://www.linkedin.com/in/camille" },
        { label: "github.com", url: "github.com/camille" },
      ],
    });
    // Toujours valide pour le schéma chiffré du coffre.
    expect(identityData.parse(result)).toEqual(result);
  });

  it("n'écrase jamais ce que le candidat a déjà saisi et évite les doublons", () => {
    const current = {
      ...emptyIdentity(),
      firstName: "Cam",
      email: "perso@example.org",
      employers: [{ name: "ACME SA", experienceId: "exp-1" }],
      links: [{ label: "Mon profil", url: "https://www.linkedin.com/in/camille" }],
    };
    const result = mergeImportedIdentity(current, imported, { E1: "exp-1" });
    expect(result.firstName).toBe("Cam");
    expect(result.lastName).toBe("");
    expect(result.email).toBe("perso@example.org");
    expect(result.employers).toEqual([
      { name: "ACME SA", experienceId: "exp-1" },
      { name: "Globex", experienceId: null },
    ]);
    expect(result.links.map((l) => l.label)).toEqual(["Mon profil", "github.com"]);
    // L'objet d'origine n'est pas modifié.
    expect(current.employers).toHaveLength(1);
  });

  it("relie après coup les employeurs enregistrés avant la création des expériences", () => {
    const before = mergeImportedIdentity(emptyIdentity(), imported);
    expect(before.employers[0]).toEqual({ name: "Acme SA", experienceId: null });
    const after = mergeImportedIdentity(before, imported, { E1: "exp-1" });
    expect(after.employers).toEqual([
      { name: "Acme SA", experienceId: "exp-1" },
      { name: "Globex", experienceId: null },
    ]);
    expect(mergeImportedIdentity(after, imported, { E1: "exp-1" })).toEqual(after);
  });

  it("garde deux passages chez le même employeur", () => {
    const twice: IdentityPayload = {
      ...imported,
      employers: [
        { name: "Acme SA", experienceRef: "E1" },
        { name: "Acme SA", experienceRef: "E2" },
      ],
    };
    const result = mergeImportedIdentity(emptyIdentity(), twice, { E1: "a", E2: "b" });
    expect(result.employers.map((e) => e.experienceId)).toEqual(["a", "b"]);
  });

  it("respecte les limites du coffre", () => {
    const long = mergeImportedIdentity(emptyIdentity(), {
      ...imported,
      fullName: "x".repeat(300),
      employers: Array.from({ length: 80 }, (_, i) => ({ name: `E${i}`, experienceRef: null })),
    });
    expect(long.firstName).toHaveLength(100);
    expect(long.employers).toHaveLength(50);
    expect(() => identityData.parse(long)).not.toThrow();
  });
});

describe("hasVaultableIdentity", () => {
  it("ignore les seules organisations (le coffre ne les conserve pas)", () => {
    const none: IdentityPayload = {
      fullName: null,
      emails: [],
      phones: [],
      links: [],
      employers: [],
      schools: [],
      organizations: ["Client"],
    };
    expect(hasVaultableIdentity(none)).toBe(false);
    expect(hasVaultableIdentity(imported)).toBe(true);
  });
});
