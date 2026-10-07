import { describe, expect, it } from "vitest";
import {
  achievementInput,
  CareerMemoryDraft,
  experienceInput,
  guardRailsInput,
  textProofInput,
  toFieldErrors,
} from "@/lib/career/schemas";

const experience = {
  roleTitle: "Développeuse back-end",
  startMonth: "2021-09",
  endMonth: "2024-02",
  seniority: "SENIOR",
  contractType: "CDI",
  sector: "FINTECH",
  companySize: "S51_200",
  companyStage: "SCALEUP",
  responsibilities: "API de paiement",
};

function errorsOf(result: { success: boolean; error?: unknown }) {
  expect(result.success).toBe(false);
  return toFieldErrors(result.error as Parameters<typeof toFieldErrors>[0]);
}

describe("experienceInput", () => {
  it("accepte une expérience valide, en cours ou terminée", () => {
    expect(experienceInput.safeParse(experience).success).toBe(true);
    const current = experienceInput.safeParse({ ...experience, endMonth: "" });
    expect(current.success && current.data.endMonth).toBeUndefined();
  });

  it("renvoie des codes d'erreur traduisibles", () => {
    expect(
      errorsOf(
        experienceInput.safeParse({
          ...experience,
          roleTitle: "  ",
          startMonth: "2021-13",
          sector: "ARMES",
          companySize: "",
        }),
      ),
    ).toEqual({
      roleTitle: "required",
      startMonth: "invalidMonth",
      sector: "invalidChoice",
      companySize: "invalidChoice",
    });
  });

  it("refuse une fin avant le début et un mois futur", () => {
    expect(errorsOf(experienceInput.safeParse({ ...experience, endMonth: "2020-01" }))).toEqual({
      endMonth: "endBeforeStart",
    });
    expect(
      errorsOf(experienceInput.safeParse({ ...experience, startMonth: "2999-01", endMonth: "" })),
    ).toEqual({
      startMonth: "futureMonth",
    });
  });

  it("n'a aucun champ d'employeur nominatif", () => {
    expect(
      Object.keys(experienceInput.parse({ ...experience, employerName: "ACME" })),
    ).not.toContain("employerName");
  });
});

describe("achievementInput", () => {
  it("découpe la liste de compétences", () => {
    const parsed = achievementInput.parse({
      title: "Refonte du paiement",
      actions: "J'ai conçu la nouvelle API",
      skills: "PostgreSQL, Node.js ;  , TypeScript",
      experienceId: "",
    });
    expect(parsed.skills).toEqual(["PostgreSQL", "Node.js", "TypeScript"]);
    expect(parsed.experienceId).toBeUndefined();
  });

  it("exige un titre et ce que j'ai fait", () => {
    expect(errorsOf(achievementInput.safeParse({ title: "", actions: "" }))).toEqual({
      title: "required",
      actions: "required",
    });
  });
});

describe("textProofInput", () => {
  it("n'accepte que des liens http(s)", () => {
    expect(textProofInput.safeParse({ kind: "URL", url: "https://exemple.fr/a" }).success).toBe(
      true,
    );
    expect(errorsOf(textProofInput.safeParse({ kind: "URL", url: "javascript:alert(1)" }))).toEqual(
      {
        url: "invalidUrl",
      },
    );
  });

  it("exige un témoignage d'au moins quelques mots", () => {
    expect(errorsOf(textProofInput.safeParse({ kind: "REFERENCE", referenceText: "Top" }))).toEqual(
      {
        referenceText: "tooShort",
      },
    );
  });
});

describe("guardRailsInput", () => {
  it("normalise les montants saisis et les listes", () => {
    const parsed = guardRailsInput.parse({
      minFixedSalary: "45 000",
      targetTotalPackage: "55 000",
      remotePolicy: "FULL_REMOTE",
      minRemoteDays: "3",
      contractTypes: ["CDI", "FREELANCE"],
      excludedSectors: ["TOBACCO_ALCOHOL"],
      excludedCompanies: ["Acme", "ACME", "Globex"],
      maxWeeklyHours: "",
      acceptsOnCall: false,
      culturePreferences: ["ASYNC_FIRST"],
      locations: [{ label: "Lyon", radiusKm: "30" }],
    });
    expect(parsed).toMatchObject({
      minFixedSalary: 45000,
      targetTotalPackage: 55000,
      minRemoteDays: undefined, // ignoré hors hybride
      excludedCompanies: ["ACME", "Globex"],
      maxWeeklyHours: undefined,
      locations: [{ label: "Lyon", radiusKm: 30 }],
    });
  });

  it("valide chaque champ et chaque lieu", () => {
    expect(
      errorsOf(
        guardRailsInput.safeParse({
          minFixedSalary: "beaucoup",
          locations: [{ label: "", radiusKm: "999" }],
          contractTypes: ["CDI"],
        }),
      ),
    ).toEqual({
      minFixedSalary: "invalidNumber",
      "contractTypes.0": "invalidChoice",
      "locations.0.label": "required",
      "locations.0.radiusKm": "outOfRange",
    });
  });

  it("vérifie la cohérence des montants et du télétravail hybride", () => {
    expect(
      errorsOf(
        guardRailsInput.safeParse({
          minFixedSalary: "60000",
          targetTotalPackage: "50000",
          remotePolicy: "HYBRID",
        }),
      ),
    ).toEqual({
      targetTotalPackage: "packageBelowSalary",
      minRemoteDays: "remoteDaysRequired",
    });
  });
});

describe("CareerMemoryDraft", () => {
  it("valide un brouillon d'import IA complet", () => {
    const draft = CareerMemoryDraft.parse({
      experiences: [{ ...experience, ref: "exp-1" }],
      achievements: [
        {
          title: "Refonte du paiement",
          actions: "Conception de l'API",
          result: "+18 % de conversion",
          skills: ["PostgreSQL"],
          experienceRef: "exp-1",
          proofs: [{ kind: "URL", url: "https://exemple.fr/article" }],
        },
      ],
      skills: ["Figma"],
    });
    expect(draft.achievements[0]?.skills).toEqual(["PostgreSQL"]);
  });

  it("refuse les preuves documentaires (envoi de fichier hors brouillon)", () => {
    expect(
      CareerMemoryDraft.safeParse({
        experiences: [],
        achievements: [{ title: "x", actions: "y", proofs: [{ kind: "DOCUMENT" }] }],
      }).success,
    ).toBe(false);
  });
});
