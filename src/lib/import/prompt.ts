import { z } from "zod";
import { languageInstruction } from "@/lib/ai/locale";
import type { ChatMessage } from "@/lib/ai/types";
import type { AppLocale } from "@/i18n/routing";
import {
  COMPANY_SIZES,
  COMPANY_STAGES,
  CONTRACT_TYPES,
  SECTORS,
  SENIORITIES,
} from "@/lib/career/codes";

/**
 * Consignes et format de réponse du modèle pour l'import. Le format est
 * volontairement tolérant (codes en texte libre, champs facultatifs) : la
 * normalisation stricte est faite ensuite par du code (`pipeline.ts`).
 */

const text = z
  .string()
  .nullish()
  .transform((v) => v ?? "");
const list = z
  .array(z.string())
  .nullish()
  .transform((v) => v ?? []);

export const ExtractionSchema = z.object({
  identity: z
    .object({
      fullName: z.string().nullish(),
      schools: z
        .array(z.object({ name: z.string(), degree: z.string().nullish() }))
        .nullish()
        .transform((v) => v ?? []),
      organizations: list,
    })
    .nullish()
    .transform((v) => v ?? { fullName: null, schools: [], organizations: [] }),
  experiences: z
    .array(
      z.object({
        ref: z.string(),
        employerName: z.string().nullish(),
        roleTitle: z.string(),
        startMonth: text,
        endMonth: z.string().nullish(),
        seniority: text,
        contractType: text,
        sector: text,
        companySize: text,
        companyStage: text,
        responsibilities: text,
        rareDetails: list,
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
  achievements: z
    .array(
      z.object({
        title: z.string(),
        context: text,
        actions: text,
        result: text,
        skills: list,
        experienceRef: z.string().nullish(),
        links: list,
        rareDetails: list,
      }),
    )
    .nullish()
    .transform((v) => v ?? []),
  skills: list,
});
export type Extraction = z.infer<typeof ExtractionSchema>;

/** Schéma montré au modèle (forme attendue, sans les tolérances du parseur). */
export const EXTRACTION_JSON_SCHEMA = {
  type: "object",
  required: ["identity", "experiences", "achievements", "skills"],
  properties: {
    identity: {
      type: "object",
      properties: {
        fullName: { type: ["string", "null"] },
        schools: {
          type: "array",
          items: {
            type: "object",
            properties: { name: { type: "string" }, degree: { type: ["string", "null"] } },
            required: ["name"],
          },
        },
        organizations: { type: "array", items: { type: "string" } },
      },
    },
    experiences: {
      type: "array",
      items: {
        type: "object",
        required: ["ref", "roleTitle", "startMonth", "sector", "companySize", "companyStage"],
        properties: {
          ref: { type: "string" },
          employerName: { type: ["string", "null"] },
          roleTitle: { type: "string" },
          startMonth: { type: "string", pattern: "^\\d{4}-\\d{2}$" },
          endMonth: { type: ["string", "null"], pattern: "^\\d{4}-\\d{2}$" },
          seniority: { enum: SENIORITIES },
          contractType: { enum: CONTRACT_TYPES },
          sector: { enum: SECTORS },
          companySize: { enum: COMPANY_SIZES },
          companyStage: { enum: COMPANY_STAGES },
          responsibilities: { type: "string" },
          rareDetails: { type: "array", items: { type: "string" } },
        },
      },
    },
    achievements: {
      type: "array",
      items: {
        type: "object",
        required: ["title", "actions"],
        properties: {
          title: { type: "string" },
          context: { type: "string" },
          actions: { type: "string" },
          result: { type: "string" },
          skills: { type: "array", items: { type: "string" } },
          experienceRef: { type: ["string", "null"] },
          links: { type: "array", items: { type: "string", pattern: "^LINK \\d+$" } },
          rareDetails: { type: "array", items: { type: "string" } },
        },
      },
    },
    skills: { type: "array", items: { type: "string" } },
  },
} as const;

const RULES = `You turn a candidate's background (CV, LinkedIn export, GitHub repositories) into a PSEUDONYMISED career memory draft for a private career agent.

PRIVACY RULES (most important):
- Draft fields (experiences, achievements, skills) must NEVER contain a person's name, e-mail, phone, address, the name of an employer, school, university, client or partner, nor a product or project name that would reveal the employer. Describe them generically instead ("a fintech scale-up", "a large retail group", "a hospital").
- Put the real names in "identity": the candidate's full name in identity.fullName, each employer's name in the experience's "employerName", schools in identity.schools, clients/partners/other identifying organisations in identity.organizations.
- In "rareDetails", list in one short sentence each any rare detail that could re-identify the candidate even without names (unique award, record, named patent, public talk, very small or unusual team, unique job title). Do not repeat names there.

EXTRACTION RULES:
- Only use facts present in the sources. Never invent numbers, dates or results.
- One experience per job. Merge the same job when it appears in several sources. If a job comes from a LinkedIn position, reuse its ref (li-1, li-2…); otherwise use refs exp-1, exp-2…
- Dates: "YYYY-MM". If only the year is known use "YYYY-01". endMonth is null for the current job.
- Codes: seniority in ${SENIORITIES.join(", ")}; contractType in ${CONTRACT_TYPES.join(", ")} (CDI = permanent contract); sector in ${SECTORS.join(", ")}; companySize in ${COMPANY_SIZES.join(", ")} (employees: S1_10 = 1-10 … S5001_PLUS = more than 5000; estimate from what you know about the employer); companyStage in ${COMPANY_STAGES.join(", ")}.
- responsibilities: 1 to 3 sentences, generic, no names.
- Achievements: one per distinct accomplishment or project. title: short; context: the situation; actions: what the candidate did personally; result: the measurable outcome if stated, else "". experienceRef: the ref of the related job, or null. skills: the skills it demonstrates (max 8). links: the "LINK n" markers that prove it (e.g. a repository), or [].
- skills: other skills the candidate declares (technologies, tools, methods, languages), short names.
- Contact details were replaced by [EMAIL], [PHONE], [PROFILE LINK]; links by [LINK n]. Never copy these markers into texts.`;

export type PromptSources = { cv?: string; linkedin?: string; github?: string };

export function buildExtractionMessages(sources: PromptSources, locale: AppLocale): ChatMessage[] {
  const sections = [
    sources.cv ? `## CV\n${sources.cv}` : null,
    sources.linkedin ? `## LinkedIn export\n${sources.linkedin}` : null,
    sources.github ? `## GitHub public repositories\n${sources.github}` : null,
  ].filter(Boolean);
  return [
    { role: "system", content: `${RULES}\n\nLANGUAGE: ${languageInstruction(locale)}` },
    { role: "user", content: `Sources:\n\n${sections.join("\n\n")}` },
  ];
}
