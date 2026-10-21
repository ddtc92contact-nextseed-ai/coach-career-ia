import { describe, expect, it } from "vitest";
import {
  computeCompleteness,
  firstRunGuide,
  isMemoryEmpty,
  type CompletenessInput,
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
    skillCount: 0,
    provenSkillCount: 0,
    guardRails: { hasSalary: false, hasLocationOrRemote: false, hasContractTypes: false },
  };

  it("part de zéro avec toutes les étapes à faire", () => {
    const result = computeCompleteness(empty);
    expect(result.score).toBe(0);
    expect(result.todo.slice(0, 2)).toEqual(["importProfile", "addExperience"]);
    expect(result.done).toEqual([]);
  });

  it("propose l'import tant que la mémoire est vide, quel que soit son point d'entrée", () => {
    expect(isMemoryEmpty(empty)).toBe(true);
    for (const filled of [
      { ...empty, experienceCount: 1 },
      { ...empty, achievements: [{ evidenceLevel: "DECLARED" as const }] },
      { ...empty, skillCount: 2 },
    ]) {
      expect(isMemoryEmpty(filled)).toBe(false);
      expect(computeCompleteness(filled).done).toContain("importProfile");
    }
    // Les garde-fous seuls ne remplissent pas la mémoire.
    const railsOnly = computeCompleteness({
      ...empty,
      guardRails: { hasSalary: true, hasLocationOrRemote: true, hasContractTypes: true },
    });
    expect(railsOnly.todo[0]).toBe("importProfile");
  });

  it("ne rapporte aucun point pour l'étape d'import elle-même", () => {
    const skillsOnly = computeCompleteness({ ...empty, skillCount: 3 });
    expect(skillsOnly.score).toBe(0);
    expect(skillsOnly.done).toEqual(["importProfile"]);
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
      skillCount: 5,
      provenSkillCount: 4,
      guardRails: { hasSalary: true, hasLocationOrRemote: true, hasContractTypes: true },
    });
    expect(result).toMatchObject({ score: 100, todo: [] });
  });

  it("ne déclare jamais le profil complet sous 100", () => {
    const result = computeCompleteness({
      experienceCount: 1,
      achievements: [{ evidenceLevel: "DOCUMENT" }],
      skillCount: 3,
      provenSkillCount: 3,
      guardRails: { hasSalary: true, hasLocationOrRemote: true, hasContractTypes: true },
    });
    expect(result.score).toBeLessThan(100);
    expect(result.todo).toEqual(["moreProofs"]);
  });
});

describe("firstRunGuide", () => {
  const rails = (hasSalary: boolean, hasLocationOrRemote: boolean, hasContractTypes: boolean) => ({
    hasSalary,
    hasLocationOrRemote,
    hasContractTypes,
  });
  const guide = (input: Partial<CompletenessInput>) =>
    firstRunGuide(
      computeCompleteness({
        experienceCount: 0,
        achievements: [],
        skillCount: 0,
        provenSkillCount: 0,
        guardRails: rails(false, false, false),
        ...input,
      }),
    );

  it("commence par la mémoire (import) pour un nouveau compte", () => {
    expect(guide({})).toEqual({
      current: "memory",
      steps: [
        { step: "memory", state: "current" },
        { step: "guardRails", state: "todo" },
        { step: "opportunities", state: "todo" },
      ],
    });
  });

  it("passe aux garde-fous une fois la mémoire remplie, tant qu'ils sont incomplets", () => {
    for (const partial of [rails(false, false, false), rails(true, true, false)]) {
      const result = guide({ experienceCount: 2, guardRails: partial });
      expect(result?.current).toBe("guardRails");
      expect(result?.steps.map((s) => s.state)).toEqual(["done", "current", "todo"]);
    }
  });

  it("revient à la mémoire si seuls les garde-fous sont posés", () => {
    const result = guide({ guardRails: rails(true, true, true) });
    expect(result?.current).toBe("memory");
    expect(result?.steps.map((s) => s.state)).toEqual(["current", "done", "todo"]);
  });

  it("disparaît dès que la mémoire et les garde-fous sont posés", () => {
    expect(guide({ skillCount: 1, guardRails: rails(true, true, true) })).toBeNull();
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
