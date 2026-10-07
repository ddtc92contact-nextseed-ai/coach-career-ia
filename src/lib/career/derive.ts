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
  provenSkillCount: number;
  guardRails: {
    hasSalary: boolean;
    hasLocationOrRemote: boolean;
    hasContractTypes: boolean;
  };
};

export const COMPLETENESS_STEPS = [
  "addExperience",
  "addAchievement",
  "addProof",
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

/**
 * Complétude du profil, sur 100 : les réalisations PROUVÉES pèsent le plus.
 * - au moins une expérience : 15
 * - réalisations : 15 par réalisation prouvée, 5 par réalisation déclarée (45 max)
 * - compétences prouvées : 5 dès une, 10 à partir de trois
 * - garde-fous : salaire 10, lieu ou télétravail 10, types de contrat 10
 */
export function computeCompleteness(input: CompletenessInput): Completeness {
  const proven = input.achievements.filter((a) => isProven(a.evidenceLevel)).length;
  const declared = input.achievements.length - proven;

  let score = 0;
  if (input.experienceCount > 0) score += 15;
  score += Math.min(45, proven * 15 + declared * 5);
  score += input.provenSkillCount >= 3 ? 10 : input.provenSkillCount > 0 ? 5 : 0;
  if (input.guardRails.hasSalary) score += 10;
  if (input.guardRails.hasLocationOrRemote) score += 10;
  if (input.guardRails.hasContractTypes) score += 10;

  const status: Record<CompletenessStep, boolean> = {
    addExperience: input.experienceCount > 0,
    addAchievement: input.achievements.length > 0,
    addProof: proven > 0,
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
