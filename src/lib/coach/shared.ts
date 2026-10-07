import { z } from "zod";
import {
  COMPANY_SIZES,
  COMPANY_STAGES,
  CONTRACT_TYPES,
  REMOTE_POLICIES,
  SECTORS,
  SENIORITIES,
} from "@/lib/career/codes";
import { achievementFields, LIMITS, locationInput } from "@/lib/career/schemas";

/**
 * Règles et types du coach IA partagés entre le serveur et l'interface
 * (aucune dépendance serveur).
 */

/** Compétences (« skills ») du coach, choisies au début d'une conversation. */
export const COACH_MODES = ["DISCOVER", "CLARIFY", "INTERVIEW"] as const;
export type CoachModeCode = (typeof COACH_MODES)[number];

export const SUGGESTION_KINDS = [
  "ACHIEVEMENT",
  "EXPERIENCE_UPDATE",
  "SKILL",
  "GUARD_RAIL",
] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const SUGGESTION_STATUSES = ["PENDING", "ACCEPTED", "REJECTED"] as const;
export type SuggestionStatus = (typeof SUGGESTION_STATUSES)[number];

export const COACH_LIMITS = {
  /** Longueur maximale d'un message du candidat. */
  messageMaxChars: 4_000,
  /** Messages d'historique renvoyés au modèle (les plus récents). */
  historyMessages: 30,
  /** Allers-retours maximum avec le modèle pour un tour (outils compris). */
  maxSteps: 6,
  /** Budget total d'un tour côté serveur ; l'interface abandonne un peu après. */
  turnBudgetMs: 90_000,
  clientTimeoutMs: 105_000,
  /** Relances possibles d'un même message resté sans réponse. */
  maxRetries: 3,
  /** Un verrou de tour plus ancien est considéré comme abandonné (processus arrêté…). */
  turnLockMs: 120_000,
  /** Réponse du coach tronquée au-delà. */
  replyMaxChars: 8_000,
} as const;

export const COACH_ERRORS = [
  "aiNotConfigured",
  "aiTimeout",
  "aiUnavailable",
  "aiRateLimited",
  "aiInvalidOutput",
  "quotaExceeded",
  "tooManyRetries",
  "busy",
  "notFound",
  "invalid",
  "unauthorized",
  "network",
  "unknown",
] as const;
export type CoachErrorCode = (typeof COACH_ERRORS)[number];

export function isCoachErrorCode(value: unknown): value is CoachErrorCode {
  return typeof value === "string" && (COACH_ERRORS as readonly string[]).includes(value);
}

// --- Contenu des suggestions (validé avant tout enregistrement) -------------------

const httpUrl = z
  .url({ protocol: /^https?$/, error: "invalidUrl" })
  .trim()
  .max(LIMITS.url, { error: "tooLong" });

export const achievementSuggestion = achievementFields.extend({
  /** Expérience du candidat à laquelle rattacher la réalisation. */
  experienceId: z.string().max(64).optional(),
  /** Lien public qui prouve le résultat (jamais un profil personnel). */
  proofUrl: httpUrl.optional(),
});

export const EXPERIENCE_UPDATE_FIELDS = [
  "roleTitle",
  "responsibilities",
  "seniority",
  "contractType",
  "sector",
  "companySize",
  "companyStage",
] as const;

export const experienceUpdateSuggestion = z.object({
  experienceId: z.string().min(1).max(64),
  changes: z
    .object({
      roleTitle: z.string().trim().min(1, { error: "required" }).max(LIMITS.roleTitle).optional(),
      responsibilities: z.string().trim().max(LIMITS.responsibilities).optional(),
      seniority: z.enum(SENIORITIES, { error: "invalidChoice" }).optional(),
      contractType: z.enum(CONTRACT_TYPES, { error: "invalidChoice" }).optional(),
      sector: z.enum(SECTORS, { error: "invalidChoice" }).optional(),
      companySize: z.enum(COMPANY_SIZES, { error: "invalidChoice" }).optional(),
      companyStage: z.enum(COMPANY_STAGES, { error: "invalidChoice" }).optional(),
    })
    .refine((changes) => Object.values(changes).some((v) => v !== undefined), {
      error: "required",
    }),
});

export const skillSuggestion = z.object({
  name: z.string().trim().min(1, { error: "required" }).max(LIMITS.skillName, { error: "tooLong" }),
});

const salary = z.number().int().min(0, { error: "outOfRange" }).max(LIMITS.maxSalary, {
  error: "outOfRange",
});

/**
 * Changement de garde-fous : seuls les champs présents sont modifiés. Les
 * entreprises exclues (noms identifiants) ne passent jamais par le coach.
 */
export const guardRailSuggestion = z
  .object({
    minFixedSalary: salary.optional(),
    targetTotalPackage: salary.optional(),
    remotePolicy: z.enum(REMOTE_POLICIES, { error: "invalidChoice" }).optional(),
    minRemoteDays: z.number().int().min(1).max(5, { error: "outOfRange" }).optional(),
    contractTypes: z
      .array(z.enum(CONTRACT_TYPES, { error: "invalidChoice" }))
      .max(10)
      .optional(),
    excludedSectors: z
      .array(z.enum(SECTORS, { error: "invalidChoice" }))
      .max(40)
      .optional(),
    maxWeeklyHours: z.number().int().min(1).max(80, { error: "outOfRange" }).optional(),
    acceptsOnCall: z.boolean().optional(),
    locations: z.array(locationInput).max(LIMITS.locations, { error: "tooMany" }).optional(),
  })
  .refine((changes) => Object.values(changes).some((v) => v !== undefined), {
    error: "required",
  });

export const SUGGESTION_SCHEMAS = {
  ACHIEVEMENT: achievementSuggestion,
  EXPERIENCE_UPDATE: experienceUpdateSuggestion,
  SKILL: skillSuggestion,
  GUARD_RAIL: guardRailSuggestion,
} as const;

export type SuggestionData = {
  ACHIEVEMENT: z.infer<typeof achievementSuggestion>;
  EXPERIENCE_UPDATE: z.infer<typeof experienceUpdateSuggestion>;
  SKILL: z.infer<typeof skillSuggestion>;
  GUARD_RAIL: z.infer<typeof guardRailSuggestion>;
};

/** Contenu stocké d'une suggestion : les données, et la justification du coach. */
export type SuggestionPayload<K extends SuggestionKind = SuggestionKind> = {
  data: SuggestionData[K];
  rationale: string;
};

export type SuggestionView = {
  [K in SuggestionKind]: {
    id: string;
    kind: K;
    status: SuggestionStatus;
    data: SuggestionData[K];
    rationale: string;
    identityRemoved: boolean;
    /** EXPERIENCE_UPDATE / ACHIEVEMENT : intitulé du poste concerné, pour l'affichage. */
    experienceTitle: string | null;
  };
}[SuggestionKind];

export type CoachMessageView = {
  id: string;
  role: "USER" | "ASSISTANT";
  content: string;
  createdAt: string;
  suggestions: SuggestionView[];
};

// --- Flux d'un tour de conversation (NDJSON, une ligne par évènement) -------------

export type CoachStreamEvent =
  /** Message du candidat enregistré (ou repris, pour un nouvel essai). */
  | { type: "accepted"; userMessage: { id: string; createdAt: string } }
  /** Progression : le coach réfléchit, lit la mémoire, prépare une suggestion. */
  | { type: "status"; status: "thinking" | "reading" | "suggesting" }
  | { type: "suggestion"; suggestion: SuggestionView }
  /** Morceau de la réponse. */
  | { type: "delta"; text: string }
  | { type: "done"; message: CoachMessageView; remaining: number }
  | { type: "error"; code: CoachErrorCode };
