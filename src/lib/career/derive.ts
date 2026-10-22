import type { EvidenceLevelCode, SkillLevelCode } from "./codes";

/**
 * Calculs dérivés de la mémoire de carrière (fonctions pures, testées) :
 * niveau de preuve, niveau et dernière utilisation des compétences, taux de
 * complétude du profil.
 */

export function isProven(level: EvidenceLevelCode): boolean {
  return level !== "DECLARED";
}

/** Niveau de preuve d'une réalisation d'après ses preuves (`VERIFIED` est conservé). */
export function evidenceLevelFor(
  current: EvidenceLevelCode,
  proofCount: number,
): EvidenceLevelCode {
  if (current === "VERIFIED") return current;
  return proofCount > 0 ? "DOCUMENT" : "DECLARED";
}

export type SkillUsage = {
  evidenceLevel: EvidenceLevelCode;
  /** Expérience liée à la réalisation ; `endMonth: null` = poste actuel. */
  experience: { startMonth: Date; endMonth: Date | null } | null;
};

export type SkillSummary = {
  level: SkillLevelCode;
  achievementCount: number;
  provenCount: number;
  /** Dernier mois d'utilisation connu (fin de l'expérience la plus récente). */
  lastUsed: Date | null;
  /** Utilisée dans le poste actuel. */
  current: boolean;
};

/**
 * - aucune réalisation : `UNPROVEN` (compétence seulement déclarée) ;
 * - réalisations sans preuve : `DECLARED` ;
 * - 1 réalisation prouvée : `DEMONSTRATED`, 2-3 : `CONFIRMED`, 4+ : `EXPERT`.
 */
export function summarizeSkill(usages: SkillUsage[]): SkillSummary {
  const provenCount = usages.filter((u) => isProven(u.evidenceLevel)).length;
  let level: SkillLevelCode;
  if (usages.length === 0) level = "UNPROVEN";
  else if (provenCount === 0) level = "DECLARED";
  else if (provenCount === 1) level = "DEMONSTRATED";
  else if (provenCount <= 3) level = "CONFIRMED";
  else level = "EXPERT";

  let lastUsed: Date | null = null;
  let current = false;
  for (const { experience } of usages) {
    if (!experience) continue;
    if (experience.endMonth === null) current = true;
    const end = experience.endMonth ?? experience.startMonth;
    if (!lastUsed || end > lastUsed) lastUsed = end;
  }
  return { level, achievementCount: usages.length, provenCount, lastUsed, current };
}

export type CompletenessInput = {
  experienceCount: number;
  achievements: { evidenceLevel: EvidenceLevelCode }[];
  skillCount: number;
  provenSkillCount: number;
  guardRails: {
    hasSalary: boolean;
    hasLocationOrRemote: boolean;
    hasContractTypes: boolean;
  };
};

export const COMPLETENESS_STEPS = [
  // Première étape d'un nouveau compte : l'import (CV, LinkedIn, GitHub) remplit
  // l'essentiel de la mémoire. La saisie manuelle reste l'étape suivante.
  "importProfile",
  "addExperience",
  "addAchievement",
  "addProof",
  "moreProofs",
  "provenSkills",
  "setSalary",
  "setLocation",
  "setContractTypes",
] as const;
export type CompletenessStep = (typeof COMPLETENESS_STEPS)[number];

export type Completeness = {
  /** Score de 0 à 100. */
  score: number;
  done: CompletenessStep[];
  todo: CompletenessStep[];
};

/** Mémoire de carrière vide : ni expérience, ni réalisation, ni compétence. */
export function isMemoryEmpty(
  input: Pick<CompletenessInput, "experienceCount" | "achievements" | "skillCount">,
): boolean {
  return input.experienceCount === 0 && input.achievements.length === 0 && input.skillCount === 0;
}

/**
 * Complétude du profil, sur 100 : les réalisations PROUVÉES pèsent le plus.
 * L'étape `importProfile` (mémoire non vide) ne rapporte aucun point : elle
 * oriente seulement un nouveau compte vers l'import.
 * - au moins une expérience : 15
 * - réalisations : 15 par réalisation prouvée, 5 par réalisation déclarée (45 max)
 * - compétences prouvées : 5 dès une, 10 à partir de trois
 * - garde-fous : salaire 10, lieu ou télétravail 10, types de contrat 10
 */
export function computeCompleteness(input: CompletenessInput): Completeness {
  const proven = input.achievements.filter((a) => isProven(a.evidenceLevel)).length;
  const declared = input.achievements.length - proven;

  const achievementPoints = proven * 15 + declared * 5;
  let score = 0;
  if (input.experienceCount > 0) score += 15;
  score += Math.min(45, achievementPoints);
  score += input.provenSkillCount >= 3 ? 10 : input.provenSkillCount > 0 ? 5 : 0;
  if (input.guardRails.hasSalary) score += 10;
  if (input.guardRails.hasLocationOrRemote) score += 10;
  if (input.guardRails.hasContractTypes) score += 10;

  const status: Record<CompletenessStep, boolean> = {
    importProfile: !isMemoryEmpty(input),
    addExperience: input.experienceCount > 0,
    addAchievement: input.achievements.length > 0,
    addProof: proven > 0,
    // Toutes les étapes faites ⇔ score de 100 : on n'affiche jamais « complet » en dessous.
    moreProofs: achievementPoints >= 45,
    provenSkills: input.provenSkillCount >= 3,
    setSalary: input.guardRails.hasSalary,
    setLocation: input.guardRails.hasLocationOrRemote,
    setContractTypes: input.guardRails.hasContractTypes,
  };
  return {
    score: Math.min(100, score),
    done: COMPLETENESS_STEPS.filter((step) => status[step]),
    todo: COMPLETENESS_STEPS.filter((step) => !status[step]),
  };
}

export const FIRST_RUN_STEPS = ["memory", "guardRails", "opportunities"] as const;
export type FirstRunStep = (typeof FIRST_RUN_STEPS)[number];
export type FirstRunGuide = {
  current: FirstRunStep;
  steps: { step: FirstRunStep; state: "done" | "current" | "todo" }[];
};

const RAIL_STEPS = ["setSalary", "setLocation", "setContractTypes"] as const;

/** Garde-fous posés : salaire plancher, lieu ou télétravail, types de contrat. */
export function guardRailsSet(completeness: Pick<Completeness, "done">): boolean {
  return RAIL_STEPS.every((step) => completeness.done.includes(step));
}

/**
 * Parcours de démarrage en trois temps : remplir la mémoire (import), fixer les
 * garde-fous (salaire, lieu ou télétravail, contrats), puis voir les
 * opportunités. `null` dès que la mémoire et les garde-fous sont posés : le
 * guide disparaît.
 */
export function firstRunGuide(completeness: Pick<Completeness, "done">): FirstRunGuide | null {
  const status: Record<FirstRunStep, boolean> = {
    memory: completeness.done.includes("importProfile"),
    guardRails: guardRailsSet(completeness),
    opportunities: false,
  };
  if (status.memory && status.guardRails) return null;
  const current = FIRST_RUN_STEPS.find((step) => !status[step])!;
  return {
    current,
    steps: FIRST_RUN_STEPS.map((step) => ({
      step,
      state: status[step] ? "done" : step === current ? "current" : "todo",
    })),
  };
}

/**
 * Seuils du « profil mince » : en dessous, les opportunités sont peu fiables
 * (trop peu de matière pour le matching). Avertissement seulement, rien n'est
 * bloqué.
 */
export const THIN_PROFILE_THRESHOLDS = {
  /** Réalisations minimum (toutes, prouvées ou non). */
  minAchievements: 3,
  /** Compétences minimum (toutes, prouvées ou non). */
  minSkills: 3,
  /** Ancienneté maximale de la dernière expérience terminée, sans poste en cours. */
  staleExperienceYears: 10,
} as const;

export const THIN_PROFILE_ISSUES = ["achievements", "skills", "staleExperience"] as const;
export type ThinProfileIssueCode = (typeof THIN_PROFILE_ISSUES)[number];

export type ThinProfileIssue =
  | { code: "achievements"; count: number; min: number }
  | { code: "skills"; count: number; min: number }
  /** `lastEnd` : fin (premier jour du mois, UTC) de l'expérience la plus récente. */
  | { code: "staleExperience"; lastEnd: Date; years: number };

export type ThinProfileInput = {
  achievementCount: number;
  skillCount: number;
  /** Fin de chaque expérience ; `null` = poste en cours. */
  experienceEnds: (Date | null)[];
};

/** Années pleines écoulées entre `from` et `to` (UTC). */
function fullYearsBetween(from: Date, to: Date): number {
  let years = to.getUTCFullYear() - from.getUTCFullYear();
  const anniversary = new Date(from);
  anniversary.setUTCFullYear(from.getUTCFullYear() + years);
  if (anniversary > to) years -= 1;
  return Math.max(0, years);
}

/**
 * Points faibles d'un profil « mince », un par critère manquant (liste vide :
 * profil assez fourni) :
 * - moins de `minAchievements` réalisations ;
 * - moins de `minSkills` compétences ;
 * - dernière expérience terminée depuis plus de `staleExperienceYears` ans,
 *   sans expérience en cours. Sans aucune expérience, ce critère ne s'applique
 *   pas (l'étape « ajouter une expérience » de la complétude s'en charge).
 */
export function thinProfileIssues(
  input: ThinProfileInput,
  now: Date = new Date(),
  thresholds: Record<keyof typeof THIN_PROFILE_THRESHOLDS, number> = THIN_PROFILE_THRESHOLDS,
): ThinProfileIssue[] {
  const issues: ThinProfileIssue[] = [];
  if (input.achievementCount < thresholds.minAchievements) {
    issues.push({
      code: "achievements",
      count: input.achievementCount,
      min: thresholds.minAchievements,
    });
  }
  if (input.skillCount < thresholds.minSkills) {
    issues.push({ code: "skills", count: input.skillCount, min: thresholds.minSkills });
  }
  const ongoing = input.experienceEnds.some((end) => end === null || end >= now);
  if (!ongoing && input.experienceEnds.length > 0) {
    const lastEnd = new Date(Math.max(...input.experienceEnds.map((end) => end!.getTime())));
    const cutoff = new Date(now);
    cutoff.setUTCFullYear(now.getUTCFullYear() - thresholds.staleExperienceYears);
    if (lastEnd < cutoff) {
      issues.push({ code: "staleExperience", lastEnd, years: fullYearsBetween(lastEnd, now) });
    }
  }
  return issues;
}

/** `AAAA-MM` → premier jour du mois (UTC), tel que stocké en base. */
export function monthToDate(month: string): Date {
  return new Date(`${month}-01T00:00:00.000Z`);
}

/** Premier jour du mois (UTC) → `AAAA-MM`, pour les champs `<input type="month">`. */
export function dateToMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

/** Clé d'unicité d'une compétence : `  Node.JS ` → `node.js`. */
export function skillKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLocaleLowerCase("fr");
}
