import "server-only";
import { z } from "zod";
import type { Tool } from "@/lib/ai/client";
import {
  COMPANY_SIZES,
  COMPANY_STAGES,
  CONTRACT_TYPES,
  REMOTE_POLICIES,
  SECTORS,
  SENIORITIES,
} from "@/lib/career/codes";
import { toFieldErrors } from "@/lib/career/schemas";
import { MODE_TOOLS, type CoachToolName } from "./prompts";
import { redactPlain, redactSuggestion } from "./redact";
import {
  careerMemorySnapshot,
  coachIdentityTerms,
  createSuggestion,
  ownsExperience,
} from "./repository";
import {
  SUGGESTION_SCHEMAS,
  type CoachModeCode,
  type SuggestionData,
  type SuggestionKind,
  type SuggestionView,
} from "./shared";

/**
 * Outils du coach. Les arguments du modèle sont tolérants (`null` accepté) ;
 * le contenu est ensuite pseudonymisé et validé strictement. Les outils
 * `propose_*` créent une suggestion EN ATTENTE : la mémoire de carrière
 * n'est modifiée que lorsque le candidat l'accepte.
 */

export type ToolEvent =
  { type: "reading" } | { type: "suggesting" } | { type: "suggestion"; suggestion: SuggestionView };

const optionalText = (max: number) =>
  z
    .string()
    .max(max * 2)
    .nullish()
    .transform((v) => v?.trim() ?? "");
const optionalEnum = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .enum(values)
    .nullish()
    .transform((v) => v ?? undefined);
const optionalInt = z
  .number()
  .nullish()
  .transform((v) => (v === null || v === undefined ? undefined : Math.round(v)));

const common = {
  rationale: optionalText(500),
  identifyingTerms: z
    .array(z.string())
    .max(50)
    .nullish()
    .transform((v) => v ?? []),
};

const COMMON_DESCRIPTIONS = {
  rationale: "One short sentence shown to the candidate: why you propose this.",
  identifyingTerms:
    "Exact names the candidate wrote that identify them (people, employers, clients, schools, emails). They are removed from the proposal.",
};

const ARGS = {
  read_career_memory: z.object({}),
  propose_achievement: z.object({
    title: z.string().max(400),
    context: optionalText(2000),
    actions: z.string().max(8000),
    result: optionalText(1000),
    skills: z
      .array(z.string().max(120))
      .max(40)
      .nullish()
      .transform((v) => v ?? []),
    experienceId: optionalText(64),
    proofUrl: optionalText(2000),
    ...common,
  }),
  propose_experience_update: z.object({
    experienceId: z.string().max(64),
    roleTitle: optionalText(120),
    responsibilities: optionalText(4000),
    seniority: optionalEnum(SENIORITIES),
    contractType: optionalEnum(CONTRACT_TYPES),
    sector: optionalEnum(SECTORS),
    companySize: optionalEnum(COMPANY_SIZES),
    companyStage: optionalEnum(COMPANY_STAGES),
    ...common,
  }),
  propose_skill: z.object({ name: z.string().max(120), ...common }),
  propose_guard_rail_change: z.object({
    minFixedSalary: optionalInt,
    targetTotalPackage: optionalInt,
    remotePolicy: optionalEnum(REMOTE_POLICIES),
    minRemoteDays: optionalInt,
    contractTypes: z.array(z.enum(CONTRACT_TYPES)).max(10).nullish(),
    excludedSectors: z.array(z.enum(SECTORS)).max(40).nullish(),
    maxWeeklyHours: optionalInt,
    acceptsOnCall: z.boolean().nullish(),
    locations: z
      .array(z.object({ label: z.string().max(200), radiusKm: z.number() }))
      .max(10)
      .nullish(),
    ...common,
  }),
} satisfies Record<CoachToolName, z.ZodType>;

const DESCRIPTIONS: Record<CoachToolName, string> = {
  read_career_memory:
    "Read the candidate's pseudonymised Career Memory: experiences (with ids), achievements, skills and guard-rails.",
  propose_achievement:
    "Propose a new achievement (STAR) as a draft card the candidate accepts, edits or rejects. Only facts the candidate stated. Never names of employers or people.",
  propose_experience_update:
    "Propose changes to one existing experience (by id from read_career_memory) as a draft card. Only include the fields that change.",
  propose_skill:
    "Propose a skill the candidate confirmed having, as a draft card the candidate accepts or rejects.",
  propose_guard_rail_change:
    "Propose a change of the candidate's guard-rails as a draft card. Only include the fields that change. Salaries are gross per year in euros; minRemoteDays only with HYBRID.",
};

const FIELD_DESCRIPTIONS: Partial<Record<CoachToolName, Record<string, string>>> = {
  propose_achievement: {
    title: "Short title of the achievement.",
    context: "Situation and task, with a generic description of the employer.",
    actions: "What the candidate did personally.",
    result: "Measurable result, with a number when the candidate gave one.",
    skills: "Skills demonstrated (technology or competence names).",
    experienceId: "Id of the experience it belongs to, from read_career_memory.",
    proofUrl: "Public URL that proves the result, if the candidate gave one.",
  },
};

function jsonSchema(name: CoachToolName): Record<string, unknown> {
  const schema = z.toJSONSchema(ARGS[name], { io: "input", unrepresentable: "any" }) as {
    properties?: Record<string, Record<string, unknown>>;
  } & Record<string, unknown>;
  delete schema.$schema;
  const fields = { ...FIELD_DESCRIPTIONS[name], ...COMMON_DESCRIPTIONS };
  for (const [key, description] of Object.entries(fields)) {
    if (schema.properties?.[key]) schema.properties[key].description = description;
  }
  return schema;
}

/** Résultat renvoyé au modèle quand le contenu proposé est invalide (codes, sans valeurs). */
function invalid(error: z.ZodError) {
  return { error: "invalid_proposal", fields: toFieldErrors(error) };
}

export function buildCoachTools(options: {
  userId: string;
  conversationId: string;
  mode: CoachModeCode;
  onEvent: (event: ToolEvent) => void;
}): Tool[] {
  const { userId, conversationId, onEvent } = options;
  let knownTerms: Promise<string[]> | undefined;
  const terms = () => (knownTerms ??= coachIdentityTerms(userId));

  async function propose<K extends SuggestionKind>(
    kind: K,
    candidate: unknown,
    meta: { rationale: string; identifyingTerms: string[] },
  ) {
    onEvent({ type: "suggesting" });
    const parsed = SUGGESTION_SCHEMAS[kind].safeParse(candidate);
    if (!parsed.success) return invalid(parsed.error);
    const redacted = redactSuggestion(kind, parsed.data as SuggestionData[K], {
      knownTerms: await terms(),
      declaredTerms: meta.identifyingTerms,
    });
    // Le texte peut être devenu invalide (titre réduit à « […] ») : revalidation.
    const checked = SUGGESTION_SCHEMAS[kind].safeParse(redacted.data);
    if (!checked.success) return invalid(checked.error);
    const rationale = redactPlain(meta.rationale.slice(0, 500), {
      knownTerms: await terms(),
      declaredTerms: meta.identifyingTerms,
    });
    const suggestion = await createSuggestion(
      userId,
      conversationId,
      kind,
      { data: checked.data as SuggestionData[K], rationale },
      redacted.changed,
    );
    onEvent({ type: "suggestion", suggestion });
    return {
      suggestionId: suggestion.id,
      status: "pending_candidate_validation",
      note: "Shown to the candidate as a card. Nothing is saved until they accept it.",
    };
  }

  async function experienceRef(id: string | undefined) {
    if (!id) return undefined;
    return (await ownsExperience(userId, id)) ? id : null;
  }

  const handlers: { [N in CoachToolName]: (args: z.output<(typeof ARGS)[N]>) => Promise<unknown> } =
    {
      read_career_memory: async () => {
        onEvent({ type: "reading" });
        return careerMemorySnapshot(userId);
      },
      propose_achievement: async (args) => {
        const experienceId = await experienceRef(args.experienceId || undefined);
        if (experienceId === null) return { error: "experience_not_found" };
        return propose(
          "ACHIEVEMENT",
          {
            title: args.title,
            context: args.context,
            actions: args.actions,
            result: args.result,
            skills: args.skills,
            experienceId,
            proofUrl: args.proofUrl || undefined,
          },
          args,
        );
      },
      propose_experience_update: async (args) => {
        if (!(await ownsExperience(userId, args.experienceId))) {
          return { error: "experience_not_found" };
        }
        const changes = {
          roleTitle: args.roleTitle || undefined,
          responsibilities: args.responsibilities || undefined,
          seniority: args.seniority,
          contractType: args.contractType,
          sector: args.sector,
          companySize: args.companySize,
          companyStage: args.companyStage,
        };
        return propose("EXPERIENCE_UPDATE", { experienceId: args.experienceId, changes }, args);
      },
      propose_skill: async (args) => propose("SKILL", { name: args.name }, args),
      propose_guard_rail_change: async (args) =>
        propose(
          "GUARD_RAIL",
          {
            minFixedSalary: args.minFixedSalary,
            targetTotalPackage: args.targetTotalPackage,
            remotePolicy: args.remotePolicy,
            minRemoteDays: args.remotePolicy === "HYBRID" ? args.minRemoteDays : undefined,
            contractTypes: args.contractTypes ?? undefined,
            excludedSectors: args.excludedSectors ?? undefined,
            maxWeeklyHours: args.maxWeeklyHours,
            acceptsOnCall: args.acceptsOnCall ?? undefined,
            locations: args.locations ?? undefined,
          },
          args,
        ),
    };

  return MODE_TOOLS[options.mode].map((name): Tool => ({
    definition: { name, description: DESCRIPTIONS[name], parameters: jsonSchema(name) },
    args: ARGS[name],
    execute: (args) => (handlers[name] as (a: unknown) => Promise<unknown>)(args),
  }));
}
