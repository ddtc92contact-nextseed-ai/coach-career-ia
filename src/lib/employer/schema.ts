import { z } from "zod";
import { COMPANY_SIZES, CONTRACT_TYPES, SECTORS, SENIORITIES } from "@/lib/career/codes";
import { websiteDomain } from "./domain";

/**
 * Validation des formulaires de l'espace entreprise. Les messages d'erreur
 * sont des CODES traduits à l'affichage (`errors.<code>`), comme pour la
 * mémoire de carrière.
 */

export const EMPLOYER_LIMITS = {
  orgName: 120,
  url: 300,
  title: 140,
  descriptionMin: 200,
  description: 15_000,
  city: 100,
  /** Montant annuel maximal accepté (en unités monétaires). */
  maxSalary: 2_000_000,
  reason: 1000,
} as const;

export const SALARY_CURRENCIES = ["EUR", "CHF", "GBP", "USD"] as const;
export const SALARY_PERIODS = ["YEAR", "MONTH", "DAY", "HOUR"] as const;
/** Télétravail : toujours explicite pour une offre directe (jamais « non précisé »). */
export const POSTING_REMOTE_POLICIES = ["ONSITE", "HYBRID", "FULL_REMOTE"] as const;
/** Pays proposés (ISO 3166-1 alpha-2). */
export const COUNTRIES = [
  "FR",
  "BE",
  "CH",
  "LU",
  "DE",
  "ES",
  "IT",
  "NL",
  "GB",
  "IE",
  "PT",
  "US",
] as const;

const requiredText = (max: number) =>
  z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(max, { error: "tooLong" });

const choice = <T extends readonly [string, ...string[]]>(values: T) =>
  z.enum(values, { error: "invalidChoice" });

/** Montant saisi librement (`55 000`, `55000`) : obligatoire, entier positif. */
const requiredAmount = z.preprocess(
  (value) => {
    if (typeof value !== "string") return value;
    const compact = value.replace(/[\s\u00a0\u202f]/g, "");
    return compact === "" ? undefined : Number(compact);
  },
  z
    .number({ error: (issue) => (issue.input === undefined ? "required" : "invalidNumber") })
    .int({ error: "invalidNumber" })
    .min(1, { error: "outOfRange" })
    .max(EMPLOYER_LIMITS.maxSalary, { error: "outOfRange" }),
);

export const organizationInput = z.object({
  name: requiredText(EMPLOYER_LIMITS.orgName),
  website: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(EMPLOYER_LIMITS.url, { error: "tooLong" })
    // « acme.fr » est accepté et complété en https://acme.fr.
    .transform((v) => (/^https?:\/\//i.test(v) ? v : `https://${v}`))
    .refine((v) => websiteDomain(v) !== null, { error: "invalidUrl" }),
  sector: choice(SECTORS),
  size: choice(COMPANY_SIZES),
  country: choice(COUNTRIES),
});
export type OrganizationInput = z.infer<typeof organizationInput>;

/**
 * Offre d'emploi. La fourchette de salaire est OBLIGATOIRE (min, max, devise,
 * période) : c'est la condition de publication sur la plateforme.
 */
export const postingInput = z
  .object({
    title: requiredText(EMPLOYER_LIMITS.title),
    description: z
      .string({ error: "required" })
      .trim()
      .min(1, { error: "required" })
      .min(EMPLOYER_LIMITS.descriptionMin, { error: "tooShort" })
      .max(EMPLOYER_LIMITS.description, { error: "tooLong" }),
    contractType: choice(CONTRACT_TYPES),
    remotePolicy: choice(POSTING_REMOTE_POLICIES),
    city: requiredText(EMPLOYER_LIMITS.city),
    country: choice(COUNTRIES),
    seniority: choice(SENIORITIES),
    sector: choice(SECTORS),
    salaryMin: requiredAmount,
    salaryMax: requiredAmount,
    salaryCurrency: choice(SALARY_CURRENCIES),
    salaryPeriod: choice(SALARY_PERIODS),
  })
  .superRefine((value, ctx) => {
    if (value.salaryMax < value.salaryMin) {
      ctx.addIssue({ code: "custom", path: ["salaryMax"], message: "salaryRange" });
    }
  });
export type PostingInput = z.infer<typeof postingInput>;

export const POSTING_FIELDS = [
  "title",
  "description",
  "contractType",
  "remotePolicy",
  "city",
  "country",
  "seniority",
  "sector",
  "salaryMin",
  "salaryMax",
  "salaryCurrency",
  "salaryPeriod",
] as const;

/** Lecture d'un `FormData` dans un objet à valider. */
export function formValues<K extends string>(formData: FormData, fields: readonly K[]) {
  return Object.fromEntries(fields.map((f) => [f, formData.get(f) ?? undefined])) as Record<
    K,
    FormDataEntryValue | undefined
  >;
}

/** Motif d'un refus ou d'une suspension (administration). */
export const reviewReason = z.string().trim().min(3).max(EMPLOYER_LIMITS.reason);
