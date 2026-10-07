import { z } from "zod";
import {
  COMPANY_SIZES,
  COMPANY_STAGES,
  CONTRACT_TYPES,
  CULTURE_PREFERENCES,
  REMOTE_POLICIES,
  SECTORS,
  SENIORITIES,
  VISIBILITY_STATUSES,
} from "./codes";

/**
 * Schémas de validation de la mémoire de carrière, partagés entre les actions
 * serveur, l'export et l'import IA (`CareerMemoryDraft`).
 *
 * Les messages d'erreur sont des CODES (`required`, `tooLong`…), traduits à
 * l'affichage via `errors.<code>` : le schéma ne dépend pas de la
 * langue.
 */
export const VALIDATION_ERRORS = [
  "required",
  "tooLong",
  "tooShort",
  "invalid",
  "invalidChoice",
  "invalidUrl",
  "invalidMonth",
  "futureMonth",
  "endBeforeStart",
  "invalidNumber",
  "outOfRange",
  "packageBelowSalary",
  "remoteDaysRequired",
  "tooMany",
  "fileRequired",
  "fileTooLarge",
  "fileType",
  "fileQuota",
  "confirmMismatch",
  "notFound",
] as const;
export type ValidationError = (typeof VALIDATION_ERRORS)[number];

export const LIMITS = {
  roleTitle: 120,
  responsibilities: 4000,
  achievementTitle: 160,
  context: 2000,
  actions: 4000,
  result: 1000,
  skillName: 60,
  skillsPerAchievement: 20,
  url: 2000,
  reference: 2000,
  referenceMin: 10,
  companyName: 120,
  excludedCompanies: 50,
  locationLabel: 100,
  locations: 10,
  maxRadiusKm: 300,
  maxSalary: 2_000_000,
} as const;

const emptyToUndefined = (value: unknown) =>
  value === "" || value === null || value === undefined ? undefined : value;

const requiredText = (max: number) =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(max, { error: "tooLong" });

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLong" })
    .optional()
    .transform((value) => value ?? "");

/** Entier facultatif saisi librement (`45 000`, `45000`). */
const optionalInt = (min: number, max: number) =>
  z.preprocess(
    (value) => (typeof value === "string" ? emptyToUndefined(value.replace(/[\s  ]/g, "")) : value),
    z.coerce
      .number({ error: "invalidNumber" })
      .int({ error: "invalidNumber" })
      .min(min, { error: "outOfRange" })
      .max(max, { error: "outOfRange" })
      .optional(),
  );

const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;
/** Mois au format `AAAA-MM` (champ `<input type="month">`). */
export const monthSchema = z.string().regex(MONTH_PATTERN, { error: "invalidMonth" });

export function currentMonth(now = new Date()): string {
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

// --- Expériences -----------------------------------------------------------

export const experienceFields = z.object({
  roleTitle: requiredText(LIMITS.roleTitle),
  startMonth: monthSchema,
  endMonth: z.preprocess(emptyToUndefined, monthSchema.optional()),
  seniority: z.enum(SENIORITIES, { error: "invalidChoice" }),
  contractType: z.enum(CONTRACT_TYPES, { error: "invalidChoice" }),
  sector: z.enum(SECTORS, { error: "invalidChoice" }),
  companySize: z.enum(COMPANY_SIZES, { error: "invalidChoice" }),
  companyStage: z.enum(COMPANY_STAGES, { error: "invalidChoice" }),
  responsibilities: optionalText(LIMITS.responsibilities),
});

type ExperienceFields = z.infer<typeof experienceFields>;

function checkExperienceDates(value: ExperienceFields, ctx: z.RefinementCtx) {
  const now = currentMonth();
  if (value.startMonth > now) {
    ctx.addIssue({ code: "custom", path: ["startMonth"], message: "futureMonth" });
  }
  if (value.endMonth && value.endMonth > now) {
    ctx.addIssue({ code: "custom", path: ["endMonth"], message: "futureMonth" });
  }
  if (value.endMonth && value.endMonth < value.startMonth) {
    ctx.addIssue({ code: "custom", path: ["endMonth"], message: "endBeforeStart" });
  }
}

export const experienceInput = experienceFields.superRefine(checkExperienceDates);
export type ExperienceInput = z.infer<typeof experienceInput>;

// --- Réalisations ------------------------------------------------------------

/** Liste de compétences : tableau, ou texte séparé par des virgules. */
export const skillNamesSchema = z.preprocess(
  (value) =>
    typeof value === "string"
      ? value
          .split(/[,;\n]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : value,
  z
    .array(
      z.string().trim().min(1, { error: "required" }).max(LIMITS.skillName, { error: "tooLong" }),
    )
    .max(LIMITS.skillsPerAchievement, { error: "tooMany" })
    .default([]),
);

export const achievementFields = z.object({
  title: requiredText(LIMITS.achievementTitle),
  context: optionalText(LIMITS.context),
  actions: requiredText(LIMITS.actions),
  result: optionalText(LIMITS.result),
  skills: skillNamesSchema,
});

export const achievementInput = achievementFields.extend({
  experienceId: z.preprocess(emptyToUndefined, z.string().max(64).optional()),
});
export type AchievementInput = z.infer<typeof achievementInput>;

// --- Preuves -------------------------------------------------------------------

export const urlProofInput = z.object({
  kind: z.literal("URL"),
  url: z
    .url({ protocol: /^https?$/, error: "invalidUrl" })
    .trim()
    .max(LIMITS.url, { error: "tooLong" }),
});

export const referenceProofInput = z.object({
  kind: z.literal("REFERENCE"),
  referenceText: z
    .string({ error: "required" })
    .trim()
    .min(LIMITS.referenceMin, { error: "tooShort" })
    .max(LIMITS.reference, { error: "tooLong" }),
});

/** Preuves qui ne sont pas des fichiers (les documents passent par `documents.ts`). */
export const textProofInput = z.discriminatedUnion("kind", [urlProofInput, referenceProofInput]);
export type TextProofInput = z.infer<typeof textProofInput>;

// --- Compétences ------------------------------------------------------------------

export const skillInput = z.object({ name: requiredText(LIMITS.skillName) });

// --- Garde-fous -------------------------------------------------------------------

export const locationInput = z.object({
  label: requiredText(LIMITS.locationLabel),
  radiusKm: z.coerce
    .number({ error: "invalidNumber" })
    .int({ error: "invalidNumber" })
    .min(0, { error: "outOfRange" })
    .max(LIMITS.maxRadiusKm, { error: "outOfRange" }),
});

export const guardRailsInput = z
  .object({
    minFixedSalary: optionalInt(0, LIMITS.maxSalary),
    targetTotalPackage: optionalInt(0, LIMITS.maxSalary),
    remotePolicy: z.preprocess(
      emptyToUndefined,
      z.enum(REMOTE_POLICIES, { error: "invalidChoice" }).optional(),
    ),
    minRemoteDays: optionalInt(1, 5),
    contractTypes: z.array(z.enum(CONTRACT_TYPES, { error: "invalidChoice" })).default([]),
    excludedSectors: z.array(z.enum(SECTORS, { error: "invalidChoice" })).default([]),
    excludedCompanies: z
      .array(z.string().trim().min(1).max(LIMITS.companyName, { error: "tooLong" }))
      .max(LIMITS.excludedCompanies, { error: "tooMany" })
      .default([]),
    maxWeeklyHours: optionalInt(1, 80),
    acceptsOnCall: z.boolean().default(false),
    culturePreferences: z
      .array(z.enum(CULTURE_PREFERENCES, { error: "invalidChoice" }))
      .default([]),
    locations: z.array(locationInput).max(LIMITS.locations, { error: "tooMany" }).default([]),
  })
  .superRefine((value, ctx) => {
    if (
      value.minFixedSalary !== undefined &&
      value.targetTotalPackage !== undefined &&
      value.targetTotalPackage < value.minFixedSalary
    ) {
      ctx.addIssue({ code: "custom", path: ["targetTotalPackage"], message: "packageBelowSalary" });
    }
    if (value.remotePolicy === "HYBRID" && value.minRemoteDays === undefined) {
      ctx.addIssue({ code: "custom", path: ["minRemoteDays"], message: "remoteDaysRequired" });
    }
  })
  .transform((value) => ({
    ...value,
    // Le nombre de jours n'a de sens qu'en hybride.
    minRemoteDays: value.remotePolicy === "HYBRID" ? value.minRemoteDays : undefined,
    // Doublons retirés ; la première saisie (et sa casse) est conservée.
    excludedCompanies: value.excludedCompanies.filter(
      (company, index, all) =>
        all.findIndex((other) => other.toLowerCase() === company.toLowerCase()) === index,
    ),
  }));
export type GuardRailsInput = z.infer<typeof guardRailsInput>;

export const visibilityInput = z.enum(VISIBILITY_STATUSES, { error: "invalidChoice" });

// --- Brouillon pour l'import IA ---------------------------------------------------

/**
 * Brouillon de mémoire de carrière produit par l'import IA (CV, export
 * LinkedIn, GitHub…), validé élément par élément par le candidat avant
 * enregistrement. Les expériences portent une référence locale (`ref`) que
 * les réalisations citent via `experienceRef`. Aucun champ identifiant :
 * l'employeur est décrit par secteur, taille et stade.
 */
export const CareerMemoryDraft = z.object({
  experiences: z
    .array(
      experienceFields
        .extend({ ref: z.string().trim().min(1).max(64) })
        .superRefine(checkExperienceDates),
    )
    .max(50),
  achievements: z
    .array(
      achievementFields.extend({
        experienceRef: z.string().trim().min(1).max(64).optional(),
        proofs: z.array(textProofInput).max(10).default([]),
      }),
    )
    .max(200),
  /** Compétences déclarées sans réalisation associée. */
  skills: z.array(z.string().trim().min(1).max(LIMITS.skillName)).max(100).default([]),
});
export type CareerMemoryDraft = z.infer<typeof CareerMemoryDraft>;

// --- Erreurs de formulaire --------------------------------------------------------

export type FieldErrors = Record<string, ValidationError>;

function isValidationError(value: string): value is ValidationError {
  return (VALIDATION_ERRORS as readonly string[]).includes(value);
}

/**
 * Première erreur de chaque champ, sous forme de code traduisible. Le chemin
 * est aplati (`locations.0.label`). Les messages zod par défaut deviennent
 * `invalid`.
 */
export function toFieldErrors(error: z.ZodError): FieldErrors {
  const errors: FieldErrors = {};
  for (const issue of error.issues) {
    const key = issue.path.map(String).join(".") || "_form";
    if (errors[key]) continue;
    errors[key] = isValidationError(issue.message) ? issue.message : "invalid";
  }
  return errors;
}
