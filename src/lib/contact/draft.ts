import { createTranslator } from "use-intl/core";
import { z } from "zod";
import { MESSAGES } from "@/i18n/messages";
import type { AppLocale } from "@/i18n/routing";
import type { AiClient } from "@/lib/ai/client";
import { isAiError } from "@/lib/ai/errors";
import { languageInstruction } from "@/lib/ai/locale";
import type { CardContent } from "@/lib/card/schema";
import { checkText } from "@/lib/card/reidentify";
import { redactText } from "@/lib/import/pseudonymise";

/**
 * Brouillon du message envoyé à l'entreprise, dans la LANGUE DE L'OFFRE.
 *
 * Il ne s'appuie que sur la carte anonyme VALIDÉE (déjà contrôlée) et sur les
 * faits de la correspondance (compétences retrouvées, score) : jamais sur la
 * mémoire brute ni sur le coffre. Le LLM formule le texte (sortie JSON
 * validée par zod) ; s'il échoue, dépasse son délai ou produit un texte qui
 * ré-identifierait le candidat, un modèle déterministe le remplace. Le
 * candidat relit, modifie et approuve toujours le brouillon.
 *
 * La mention « préparé par un agent IA » et les liens sont ajoutés par
 * `email.ts`, jamais confiés au modèle.
 */

export type DraftFacts = {
  locale: AppLocale;
  offerTitle: string;
  companyName: string | null;
  score: number;
  /** Carte publique validée. */
  card: CardContent;
  /** Compétences de la carte que l'offre demande (explication du matching). */
  matchedSkills: { name: string; proven: boolean }[];
};

export type Draft = { subject: string; body: string; source: "llm" | "rules" };

export const MAX_SUBJECT = 160;
export const MAX_BODY = 3000;

function translator(locale: AppLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "email.contact" });
}

function codesTranslator(locale: AppLocale) {
  return createTranslator({ locale, messages: MESSAGES[locale], namespace: "codes" });
}

export function draftSubject(locale: AppLocale, offerTitle: string): string {
  const subject = translator(locale)("subject", { title: offerTitle });
  return subject.length <= MAX_SUBJECT ? subject : `${subject.slice(0, MAX_SUBJECT - 1)}…`;
}

function list(locale: AppLocale, items: string[]) {
  return new Intl.ListFormat(locale, { style: "long", type: "conjunction" }).format(items);
}

/** Achievements à mettre en avant : prouvés d'abord (la carte est déjà triée). */
function highlights(card: CardContent) {
  return card.achievements.slice(0, 3);
}

/** Brouillon déterministe (repli, ou sans IA configurée). */
export function ruleDraftBody(facts: DraftFacts): string {
  const t = translator(facts.locale);
  const codes = codesTranslator(facts.locale);
  const { card } = facts;
  const lines = [t("draft.greeting"), ""];
  lines.push(t("draft.intro", { title: facts.offerTitle }));
  const seniority = card.seniority ? codes(`seniority.${card.seniority}`) : null;
  const profile = [card.headline, seniority].filter(Boolean).join(" · ");
  lines.push(
    card.yearsOfExperience
      ? t("draft.profileYears", { profile, years: card.yearsOfExperience })
      : t("draft.profile", { profile }),
  );
  const items = highlights(card);
  if (items.length > 0) {
    lines.push("", t("draft.highlights"));
    for (const a of items) {
      const evidence = codes(`evidence.${a.evidenceLevel}`);
      lines.push(
        a.result ? `• ${a.title} — ${a.result} (${evidence})` : `• ${a.title} (${evidence})`,
      );
    }
  }
  const proven = facts.matchedSkills.filter((s) => s.proven).map((s) => s.name);
  const skills = proven.length > 0 ? proven : facts.matchedSkills.map((s) => s.name);
  if (skills.length > 0) {
    lines.push(
      "",
      t(proven.length > 0 ? "draft.provenSkills" : "draft.skills", {
        skills: list(facts.locale, skills.slice(0, 6)),
      }),
    );
  }
  lines.push("", t("draft.closing"), "", t("draft.signoff"));
  return lines.join("\n");
}

const phrasedDraft = z.object({ body: z.string().trim().min(80).max(MAX_BODY) });

export const DRAFT_TIMEOUT_MS = 20_000;

/** Faits transmis au modèle : uniquement la carte publique validée et la correspondance. */
export function draftPromptFacts(facts: DraftFacts) {
  const { card } = facts;
  return {
    offer: { title: facts.offerTitle, company: facts.companyName },
    matchScore: facts.score,
    candidate: {
      headline: card.headline,
      seniority: card.seniority,
      yearsOfExperience: card.yearsOfExperience,
      achievements: highlights(card).map((a) => ({
        title: a.title,
        result: a.result,
        evidence: a.evidenceLevel === "DECLARED" ? "declared, no proof yet" : "backed by a proof",
      })),
      skillsMatchingTheOffer: facts.matchedSkills,
    },
  };
}

/**
 * Formule le message avec le LLM. Lève une `AiError` en cas d'échec ; renvoie
 * `null` si le texte produit n'est pas partageable (l'appelant se replie).
 */
export async function llmDraftBody(
  client: AiClient,
  facts: DraftFacts,
  terms: string[],
  options: { signal?: AbortSignal; timeoutMs?: number } = {},
): Promise<string | null> {
  const { object } = await client.generateObject({
    purpose: "contact.draft",
    schema: phrasedDraft,
    temperature: 0.3,
    maxTokens: 700,
    timeoutMs: options.timeoutMs ?? DRAFT_TIMEOUT_MS,
    maxRetries: 1,
    signal: options.signal,
    messages: [
      {
        role: "system",
        content: [
          "You are the AI career agent of an anonymous job candidate. You write, on their behalf, a short first message (90 to 180 words) to a company about one of its job offers, to be sent to the application address published in the offer.",
          'Speak as the agent ("I am the AI career agent of a candidate…"), never as the candidate. Start with a greeting and end with a polite closing formula, without any signature or name.',
          "Explain concisely why the profile matches the offer, using ONLY the facts given as JSON. Never invent experience, figures, employers, schools, dates, availability or salary. Say honestly when an achievement is declared rather than proven. No flattery, no bluff, no urgency.",
          "Never write a name, an email address, a phone number, a link, a company the candidate worked for, a school or a date: the candidate must stay anonymous. Do not mention links: they are appended separately.",
          'Return {"body": "..."} with line breaks as \\n.',
          languageInstruction(facts.locale),
        ].join("\n"),
      },
      { role: "user", content: JSON.stringify(draftPromptFacts(facts)) },
    ],
  });
  const body = redactText(object.body, terms).text;
  // Un texte qui ré-identifierait le candidat n'est jamais proposé.
  return checkText(body, "body", { terms }).length > 0 ? null : body;
}

/**
 * Brouillon complet. `client: null` (pas d'IA configurée) donne directement le
 * modèle déterministe.
 */
export async function buildDraft(
  facts: DraftFacts,
  client: AiClient | null,
  terms: string[],
  options: { signal?: AbortSignal; timeoutMs?: number; onError?: (code: string) => void } = {},
): Promise<Draft> {
  const subject = draftSubject(facts.locale, facts.offerTitle);
  if (client) {
    try {
      const body = await llmDraftBody(client, facts, terms, options);
      if (body) return { subject, body, source: "llm" };
      options.onError?.("reidentifying");
    } catch (error) {
      options.onError?.(isAiError(error) ? error.code : "unexpected");
    }
  }
  return { subject, body: ruleDraftBody(facts), source: "rules" };
}
