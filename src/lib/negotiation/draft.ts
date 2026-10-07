import { createTranslator } from "use-intl/core";
import { z } from "zod";
import { MESSAGES } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import type { AiClient } from "@/lib/ai/client";
import { isAiError } from "@/lib/ai/errors";
import { languageInstruction } from "@/lib/ai/locale";
import { checkMessage, termsForTarget } from "@/lib/card/reidentify";
import { redactText } from "@/lib/import/pseudonymise";
import type { OfferAnalysis } from "./analysis";
import { allowedFigures, checkOutgoing } from "./check";
import { MAX_MESSAGE, type Mandate, type NegotiationOutcome } from "./mandate";

export { MAX_MESSAGE };

/**
 * Brouillons de l'agent de négociation, dans la LANGUE DE L'OFFRE :
 * contre-proposition (`counter`) ou message de clôture (`closing`) après la
 * décision du candidat.
 *
 * Le LLM ne reçoit que le mandat, l'intitulé de l'offre et les messages de
 * l'entreprise (termes identifiants du candidat retirés) : jamais le coffre
 * d'identité ni la mémoire brute. Sa sortie (JSON validé par zod) passe un
 * contrôle déterministe (plancher, non négociables, faits et chiffres non
 * fournis, ré-identification) ; au moindre problème, ou si le fournisseur
 * échoue, un modèle déterministe le remplace. Le candidat relit, modifie et
 * approuve toujours le texte, et la mention de transparence est ajoutée à
 * l'envoi, hors du texte modifiable.
 */

export type DraftKind = "counter" | "closing";

export type NegotiationFacts = {
  locale: AppLocale;
  offerTitle: string;
  companyName: string | null;
  mandate: Mandate;
  /** Messages de l'entreprise, du plus ancien au plus récent (termes identifiants retirés). */
  companyMessages: string[];
  analysis: OfferAnalysis | null;
  offerSalary: { min: number | null; max: number | null };
  outcome: NegotiationOutcome;
};

export type NegotiationDraft = {
  body: string;
  source: "llm" | "rules";
  /** Raison du repli sur le modèle (code d'erreur IA, `check`), sinon absent. */
  fallback?: string;
};

export const NEGOTIATION_TIMEOUT_MS = 20_000;
const MAX_COMPANY_MESSAGE = 1500;

function translator(locale: AppLocale) {
  return createTranslator({
    locale,
    messages: MESSAGES[locale],
    namespace: "email.negotiation.draft",
  });
}

export function formatSalary(locale: AppLocale, value: number): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(locale: AppLocale, iso: string): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "long", timeZone: "UTC" }).format(
    new Date(`${iso}T12:00:00Z`),
  );
}

/** Contre-proposition déterministe (repli, ou sans IA configurée). */
export function ruleCounterBody(facts: NegotiationFacts): string {
  const t = translator(facts.locale);
  const contracts = createTranslator({
    locale: facts.locale,
    messages: MESSAGES[facts.locale],
    namespace: "codes.contractType",
  });
  const m = facts.mandate;
  const lines = [t("greeting"), "", t("intro", { title: facts.offerTitle }), ""];
  lines.push(t("salary", { amount: formatSalary(facts.locale, m.salaryTarget ?? m.salaryFloor) }));
  const essentials: string[] = [];
  if (m.remoteDaysMin) essentials.push(t("remote", { days: m.remoteDaysMin }));
  if (m.contractType) essentials.push(t("contract", { contract: contracts(m.contractType) }));
  if (m.location) essentials.push(t("location", { location: m.location }));
  if (m.startDate) essentials.push(t("startDate", { date: formatDate(facts.locale, m.startDate) }));
  if (m.title) essentials.push(t("title", { title: m.title }));
  essentials.push(...m.otherPoints);
  if (essentials.length > 0) {
    lines.push("", t("essentials"), ...essentials.map((e) => `• ${e}`));
  }
  if (m.niceToHave.length > 0) {
    lines.push("", t("niceToHave"), ...m.niceToHave.map((e) => `• ${e}`));
  }
  lines.push("", t("availability"), "", t("signoff"));
  return lines.join("\n");
}

/** Message de clôture déterministe, selon la décision du candidat. */
export function ruleClosingBody(facts: NegotiationFacts): string {
  const t = translator(facts.locale);
  const key =
    facts.outcome === "ACCEPTED"
      ? "closingAccepted"
      : facts.outcome === "DECLINED"
        ? "closingDeclined"
        : "closingPaused";
  return [t("greeting"), "", t(key, { title: facts.offerTitle }), "", t("signoff")].join("\n");
}

export function ruleBody(kind: DraftKind, facts: NegotiationFacts): string {
  return kind === "counter" ? ruleCounterBody(facts) : ruleClosingBody(facts);
}

const phrased = z.object({ body: z.string().trim().min(40).max(MAX_MESSAGE) });

/** Faits transmis au modèle : mandat, offre et messages de l'entreprise, rien d'autre. */
export function negotiationPromptFacts(kind: DraftKind, facts: NegotiationFacts) {
  const m = facts.mandate;
  return {
    task: kind === "counter" ? "counter-proposal" : `closing message (${facts.outcome})`,
    offer: {
      title: facts.offerTitle,
      company: facts.companyName,
      publishedSalaryRange: facts.offerSalary,
    },
    mandate: {
      salaryFloorNeverGoBelowAndNeverMention: m.salaryFloor,
      salaryTarget: m.salaryTarget,
      nonNegotiable: {
        minRemoteDaysPerWeek: m.remoteDaysMin,
        location: m.location,
        contractType: m.contractType,
        earliestStartDate: m.startDate,
        jobTitle: m.title,
        other: m.otherPoints,
      },
      niceToHave: m.niceToHave,
      factsTheCandidateAllowsYouToState: m.facts,
    },
    companyMessages: facts.companyMessages
      .slice(-3)
      .map((text) => text.slice(0, MAX_COMPANY_MESSAGE)),
    estimateOfLatestCompanyOffer: facts.analysis,
  };
}

const SYSTEM = [
  "You are the AI career agent of a job candidate. You negotiate salary and conditions with a company ON THEIR BEHALF, transparently: the candidate reviews and approves every message before it is sent, and a notice saying so is appended separately.",
  'Speak as the agent ("the candidate", "they"), never as the candidate, never sign with a name. Start with a greeting, end with a polite closing formula. 80 to 220 words.',
  "GOOD FAITH: use ONLY the facts given as JSON. Never invent a competing offer, a current or past salary, a figure, a percentage, a deadline or any other fact. Mention another offer or a current salary only if it is written in factsTheCandidateAllowsYouToState.",
  "Never propose, suggest or accept any amount below the salary floor, and never write the floor itself: ask for the target (or, without target, the floor). Do not repeat the company's figures if they are below the floor.",
  "Never concede a non-negotiable point; restate them clearly. Present nice-to-have points as wishes.",
  "Never accept an offer or commit the candidate: nothing is agreed until the candidate confirms it personally.",
  "Never write a name, an email address, a phone number, a link, a former employer or a school.",
].join("\n");

const CLOSING = {
  ACCEPTED:
    "Task: the candidate has decided to accept the company's latest proposal. Write a short, warm message saying the candidate wishes to move forward on that basis and will confirm the details personally (contract, start date). Do not restate figures.",
  DECLINED:
    "Task: the candidate has decided to decline. Write a short, courteous message thanking the company and declining, without justification beyond what the JSON says. Do not restate figures.",
  PAUSED:
    "Task: the candidate is pausing the negotiation. Write a short, courteous message saying the candidate needs a little time and will come back to the company. Do not restate figures.",
  ACTIVE: "",
} satisfies Record<NegotiationOutcome, string>;

/**
 * Formule le message avec le LLM. Lève une `AiError` en cas d'échec ; renvoie
 * `null` si le texte ne passe pas les contrôles (l'appelant se replie).
 */
export async function llmNegotiationBody(
  client: AiClient,
  kind: DraftKind,
  facts: NegotiationFacts,
  context: { terms: string[]; revealed: boolean },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string | null> {
  const task =
    kind === "counter"
      ? "Task: write the candidate's counter-proposal answering the company's latest message, following the mandate."
      : CLOSING[facts.outcome];
  const { object } = await client.generateObject({
    purpose: `negotiation.${kind}`,
    schema: phrased,
    temperature: 0.3,
    maxTokens: 900,
    timeoutMs: options.timeoutMs ?? NEGOTIATION_TIMEOUT_MS,
    maxRetries: 1,
    signal: options.signal,
    messages: [
      {
        role: "system",
        content: [
          SYSTEM,
          task,
          'Return {"body": "..."} with line breaks as \\n.',
          languageInstruction(facts.locale),
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(negotiationPromptFacts(kind, facts)) },
    ],
  });
  const target = { offerTitle: facts.offerTitle, companyName: facts.companyName };
  const body = redactText(object.body, termsForTarget(context.terms, target)).text;
  if (body.includes("[…]")) return null;
  const allowed = allowedFigures(facts.mandate, facts.companyMessages, [
    facts.offerSalary.min,
    facts.offerSalary.max,
  ]);
  if (checkOutgoing(body, facts.mandate, { allowed }).length > 0) return null;
  if (!context.revealed && identityIssues(body, context.terms, target).length > 0) return null;
  return body;
}

/**
 * Éléments qui ré-identifieraient le candidat (avant levée d'anonymat). Une
 * date (prise de poste) n'en est pas un dans une négociation.
 */
export function identityIssues(
  text: string,
  terms: string[],
  target: { offerTitle: string; companyName: string | null },
) {
  return checkMessage(text, "body", { terms, target }).filter((i) => i.code !== "date");
}

/** Brouillon complet ; `client: null` (pas d'IA) donne directement le modèle. */
export async function buildNegotiationDraft(
  kind: DraftKind,
  facts: NegotiationFacts,
  client: AiClient | null,
  context: { terms: string[]; revealed: boolean },
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<NegotiationDraft> {
  let fallback: string | undefined;
  if (client) {
    try {
      const body = await llmNegotiationBody(client, kind, facts, context, options);
      if (body) return { body, source: "llm" };
      fallback = "check";
    } catch (error) {
      fallback = isAiError(error) ? error.code : "unexpected";
    }
  }
  return { body: ruleBody(kind, facts), source: "rules", ...(fallback ? { fallback } : {}) };
}
