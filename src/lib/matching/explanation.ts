import { createTranslator } from "use-intl/core";
import { z } from "zod";
import { MESSAGES } from "@/i18n/messages";
import { LOCALES, type AppLocale } from "@/i18n/routing";
import type { AiClient } from "@/lib/ai/client";
import { isAiError } from "@/lib/ai/errors";
import { languageInstruction } from "@/lib/ai/locale";
import { CULTURE_PREFERENCES } from "@/lib/career/codes";
import type { Evaluation } from "./score";
import { GAP_CODES, UNKNOWN_CODES } from "./types";

/**
 * Explication d'une correspondance, stockée avec elle (`matches.explanation`)
 * dans la langue du candidat :
 * - des FAITS structurés, calculés par les règles (réalisations qui répondent
 *   à une exigence, compétences citées, écarts, inconnues) : l'interface les
 *   affiche traduits ;
 * - un résumé rédigé. Le LLM ne sert qu'à le FORMULER à partir de ces faits
 *   (sortie JSON validée par zod) ; s'il échoue ou dépasse son délai, un
 *   résumé déterministe le remplace. Une correspondance a donc toujours une
 *   explication.
 */

const component = z.number().int().min(0).max(100);

export const explanationSchema = z.object({
  version: z.literal(1),
  locale: z.enum(LOCALES),
  /** `llm` : résumé formulé par le modèle ; `rules` : résumé déterministe. */
  source: z.enum(["llm", "rules"]),
  summary: z.string(),
  components: z.object({
    skills: component,
    seniority: component,
    salary: component,
    culture: component,
  }),
  matches: z.array(
    z.object({
      achievementId: z.string(),
      achievement: z.string(),
      requirement: z.string().nullable(),
      proven: z.boolean(),
    }),
  ),
  skills: z.array(z.object({ name: z.string(), proven: z.boolean() })),
  culture: z.array(z.enum(CULTURE_PREFERENCES)),
  gaps: z.array(z.object({ code: z.enum(GAP_CODES), value: z.string().optional() })),
  unknowns: z.array(z.enum(UNKNOWN_CODES)),
});
export type Explanation = z.infer<typeof explanationSchema>;
export type ExplanationFacts = Omit<Explanation, "version" | "locale" | "source" | "summary">;

/** Faits d'explication d'une évaluation (sans le résumé). */
export function explanationFacts(evaluation: Evaluation): ExplanationFacts {
  return {
    components: evaluation.components,
    matches: evaluation.matches,
    skills: evaluation.skills,
    culture: evaluation.culture,
    gaps: evaluation.gaps,
    unknowns: evaluation.unknowns,
  };
}

export function matchingTranslator(locale: AppLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "matching" });
}

export type ScoreBand = "strong" | "good" | "fair";
export function scoreBand(score: number): ScoreBand {
  return score >= 75 ? "strong" : score >= 55 ? "good" : "fair";
}

function list(locale: AppLocale, items: string[]): string {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** Lignes lisibles des faits, dans la langue demandée (affichage, résumé, e-mail). */
export function factLines(facts: ExplanationFacts, locale: AppLocale) {
  const t = matchingTranslator(locale);
  return {
    matches: facts.matches.map((m) =>
      m.requirement
        ? t("match", { achievement: m.achievement, requirement: m.requirement })
        : t("matchSemantic", { achievement: m.achievement }),
    ),
    gaps: facts.gaps.map((g) => t(`gaps.${g.code}`, { value: g.value ?? "" })),
    unknowns: facts.unknowns.map((u) => t(`unknowns.${u}`)),
  };
}

/** Résumé déterministe (repli quand le LLM est indisponible). */
export function ruleSummary(score: number, facts: ExplanationFacts, locale: AppLocale): string {
  const t = matchingTranslator(locale);
  const parts = [t(`summary.${scoreBand(score)}`, { score })];
  const proven = facts.skills.filter((s) => s.proven).map((s) => s.name);
  const named = (proven.length > 0 ? proven : facts.skills.map((s) => s.name)).slice(0, 3);
  if (named.length > 0) {
    parts.push(
      t(proven.length > 0 ? "summary.provenSkills" : "summary.declaredSkills", {
        count: named.length,
        skills: list(locale, named),
      }),
    );
  } else {
    parts.push(t("summary.noSkills"));
  }
  const direct = facts.matches.filter((m) => m.requirement).length;
  if (direct > 0) parts.push(t("summary.proofs", { count: direct }));
  if (facts.gaps.some((g) => g.code === "seniorityAbove")) parts.push(t("summary.seniorityAbove"));
  if (facts.unknowns.includes("salaryNotStated")) parts.push(t("summary.salaryUnknown"));
  return parts.join(" ");
}

const phrasedSummary = z.object({ summary: z.string().trim().min(20).max(700) });

/** Délai de la formulation : au-delà, le résumé déterministe est utilisé. */
export const PHRASING_TIMEOUT_MS = 15_000;

/**
 * Formule le résumé avec le LLM, à partir des seuls faits calculés. Lève une
 * `AiError` en cas d'échec (l'appelant se replie sur `ruleSummary`).
 */
export async function phraseSummary(
  client: AiClient,
  input: { offerTitle: string; score: number; facts: ExplanationFacts; locale: AppLocale },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string> {
  const lines = factLines(input.facts, input.locale);
  const facts = {
    offer: input.offerTitle,
    score: input.score,
    matchedSkills: input.facts.skills.map((s) => ({ name: s.name, proven: s.proven })),
    matchedAchievements: lines.matches,
    gaps: lines.gaps,
    unknowns: lines.unknowns,
  };
  const { object } = await client.generateObject({
    purpose: "matching.explain",
    schema: phrasedSummary,
    temperature: 0.2,
    maxTokens: 400,
    timeoutMs: options.timeoutMs ?? PHRASING_TIMEOUT_MS,
    maxRetries: 1,
    signal: options.signal,
    messages: [
      {
        role: "system",
        content: [
          "You are a private career agent. You explain to a candidate, in 2 or 3 short sentences (under 450 characters), why a job offer was selected for them.",
          "Use ONLY the facts given as JSON: mention the strongest matched achievement or proven skill, then the main gap or missing information. Never invent facts, figures, company details or requirements. Address the candidate directly and politely.",
          'Return {"summary": "..."}.',
          languageInstruction(input.locale),
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(facts) },
    ],
  });
  return object.summary;
}

/**
 * Explication complète d'une correspondance. `client: null` (pas d'IA, ou
 * budget d'appels épuisé) donne directement le résumé déterministe.
 */
export async function buildExplanation(
  input: { offerTitle: string; score: number; facts: ExplanationFacts; locale: AppLocale },
  client: AiClient | null,
  options: { signal?: AbortSignal; timeoutMs?: number; onError?: (code: string) => void } = {},
): Promise<Explanation> {
  const base = { version: 1 as const, locale: input.locale, ...input.facts };
  if (client) {
    try {
      const summary = await phraseSummary(client, input, options);
      return { ...base, source: "llm", summary };
    } catch (error) {
      options.onError?.(isAiError(error) ? error.code : "unexpected");
    }
  }
  return { ...base, source: "rules", summary: ruleSummary(input.score, input.facts, input.locale) };
}

/** Lecture sûre d'une explication stockée (`null` si illisible). */
export function parseExplanation(value: unknown): Explanation | null {
  const parsed = explanationSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

const NO_FACTS: ExplanationFacts = {
  components: { skills: 0, seniority: 0, salary: 0, culture: 0 },
  matches: [],
  skills: [],
  culture: [],
  gaps: [],
  unknowns: [],
};

/**
 * Résumé à afficher dans `locale` : le résumé stocké s'il est dans cette
 * langue, sinon le résumé déterministe (langue changée depuis le calcul,
 * explication illisible). Jamais vide.
 */
export function displaySummary(
  explanation: Explanation | null,
  score: number,
  locale: AppLocale,
): string {
  if (explanation?.locale === locale && explanation.summary.trim()) return explanation.summary;
  return ruleSummary(score, explanation ?? NO_FACTS, locale);
}
