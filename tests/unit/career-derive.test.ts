import { describe, expect, it } from "vitest";
import {
  computeCompleteness,
  dateToMonth,
  evidenceLevelFor,
  monthToDate,
  skillKey,
  summarizeSkill,
} from "@/lib/career/derive";

const month = (m: string) => monthToDate(m);

describe("evidenceLevelFor", () => {
  it("passe à « document » dès la première preuve, et revient à « déclarée » sans preuve", () => {
    expect(evidenceLevelFor("DECLARED", 1)).toBe("DOCUMENT");
    expect(evidenceLevelFor("DOCUMENT", 0)).toBe("DECLARED");
    expect(evidenceLevelFor("VERIFIED", 0)).toBe("VERIFIED");
  });
});

describe("summarizeSkill", () => {
  it("marque comme non prouvée une compétence sans réalisation", () => {
    expect(summarizeSkill([])).toEqual({
      level: "UNPROVEN",
      achievementCount: 0,
      provenCount: 0,
      lastUsed: null,
      current: false,
    });
  });

  it("calcule le niveau à partir des réalisations prouvées", () => {
    const declared = { evidenceLevel: "DECLARED" as const, experience: null };
    const proven = { evidenceLevel: "DOCUMENT" as const, experience: null };
    expect(summarizeSkill([declared]).level).toBe("DECLARED");
    expect(summarizeSkill([declared, proven]).level).toBe("DEMONSTRATED");
    expect(summarizeSkill([proven, proven]).level).toBe("CONFIRMED");
    expect(summarizeSkill([proven, proven, proven, proven]).level).toBe("EXPERT");
  });

  it("déduit la dernière utilisation des expériences liées", () => {
    const summary = summarizeSkill([
      {
        evidenceLevel: "DOCUMENT",
        experience: { startMonth: month("2018-01"), endMonth: month("2020-06") },
      },
      {
        evidenceLevel: "DECLARED",
        experience: { startMonth: month("2021-01"), endMonth: month("2022-03") },
      },
    ]);
    expect(summary.lastUsed && dateToMonth(summary.lastUsed)).toBe("2022-03");
    expect(summary.current).toBe(false);
    expect(
      summarizeSkill([
        { evidenceLevel: "DECLARED", experience: { startMonth: month("2023-01"), endMonth: null } },
      ]).current,
    ).toBe(true);
  });
});

describe("computeCompleteness", () => {
  const empty = {
    experienceCount: 0,
    achievements: [],
    provenSkillCount: 0,
    guardRails: { hasSalary: false, hasLocationOrRemote: false, hasContractTypes: false },
  };

  it("part de zéro avec toutes les étapes à faire", () => {
    const result = computeCompleteness(empty);
    expect(result.score).toBe(0);
    expect(result.todo[0]).toBe("addExperience");
    expect(result.done).toEqual([]);
  });

  it("récompense davantage une réalisation prouvée qu'une réalisation déclarée", () => {
    const declared = computeCompleteness({
      ...empty,
      achievements: [{ evidenceLevel: "DECLARED" }],
    });
    const proven = computeCompleteness({ ...empty, achievements: [{ evidenceLevel: "DOCUMENT" }] });
    expect(proven.score).toBeGreaterThan(declared.score);
    expect(proven.done).toContain("addProof");
    expect(declared.todo).toContain("addProof");
  });

  it("atteint 100 pour un profil complet", () => {
    const result = computeCompleteness({
      experienceCount: 2,
      achievements: [
        { evidenceLevel: "DOCUMENT" },
        { evidenceLevel: "DOCUMENT" },
        { evidenceLevel: "VERIFIED" },
      ],
      provenSkillCount: 4,
      guardRails: { hasSalary: true, hasLocationOrRemote: true, hasContractTypes: true },
    });
    expect(result).toMatchObject({ score: 100, todo: [] });
  });
});

describe("utilitaires", () => {
  it("convertit les mois", () => {
    expect(dateToMonth(monthToDate("2024-11"))).toBe("2024-11");
  });

  it("normalise les noms de compétences", () => {
    expect(skillKey("  Node.JS   avancé ")).toBe("node.js avancé");
  });
});
