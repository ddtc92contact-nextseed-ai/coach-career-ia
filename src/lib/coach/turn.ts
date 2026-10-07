import "server-only";
import type { AiClient } from "@/lib/ai/client";
import { AiError, isAiError, type AiErrorCode } from "@/lib/ai/errors";
import type { ChatMessage } from "@/lib/ai/types";
import type { AppLocale } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import { coachSystemPrompt } from "./prompts";
import { addMessage, attachSuggestions, discardSuggestions, loadHistory } from "./repository";
import {
  COACH_LIMITS,
  type CoachErrorCode,
  type CoachModeCode,
  type CoachStreamEvent,
  type SuggestionView,
} from "./shared";
import { buildCoachTools } from "./tools";

/**
 * Un tour de conversation avec le coach : boucle d'appel d'outils (nombre
 * d'étapes et budget de temps limités), diffusée en NDJSON. Le message du
 * candidat est enregistré AVANT l'appel au modèle : une panne du fournisseur
 * ne fait jamais perdre la conversation. En cas d'échec, l'évènement `error`
 * porte un code et les suggestions du tour sont abandonnées.
 *
 * Journal : compteurs et codes uniquement, jamais le contenu des messages.
 */

const FROM_AI: Record<AiErrorCode, CoachErrorCode> = {
  notConfigured: "aiNotConfigured",
  timeout: "aiTimeout",
  aborted: "aiTimeout",
  unavailable: "aiUnavailable",
  rateLimited: "aiRateLimited",
  badRequest: "aiUnavailable",
  invalidOutput: "aiInvalidOutput",
};

export function coachErrorCode(error: unknown): CoachErrorCode {
  return isAiError(error) ? FROM_AI[error.code] : "unknown";
}

/** Découpe la réponse en morceaux de quelques mots, envoyés au fil de l'eau. */
export function chunkText(text: string, size = 24): string[] {
  const parts = text.match(/\S+\s*/g) ?? [];
  const chunks: string[] = [];
  for (let i = 0; i < parts.length; i += size) chunks.push(parts.slice(i, i + size).join(""));
  return chunks;
}

export type CoachTurnInput = {
  ai: AiClient;
  userId: string;
  conversationId: string;
  mode: CoachModeCode;
  locale: AppLocale;
  /** Annulation par le navigateur. */
  signal: AbortSignal;
  /** Message du candidat déjà enregistré (ou repris pour un nouvel essai). */
  userMessage: { id: string; createdAt: Date };
  /** Messages restants après celui-ci. */
  remaining: number;
};

export function streamCoachTurn(input: CoachTurnInput): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    async start(controller) {
      let open = true;
      const send = (event: CoachStreamEvent) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          open = false;
        }
      };
      send({
        type: "accepted",
        userMessage: {
          id: input.userMessage.id,
          createdAt: input.userMessage.createdAt.toISOString(),
        },
      });
      try {
        await runTurn(input, send);
      } finally {
        open = false;
        try {
          controller.close();
        } catch {
          // Flux déjà fermé par le navigateur.
        }
      }
    },
  });
}

async function runTurn(input: CoachTurnInput, send: (event: CoachStreamEvent) => void) {
  const { ai, userId, conversationId, mode } = input;
  const started = Date.now();
  const suggestions: SuggestionView[] = [];
  let steps = 0;
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(COACH_LIMITS.turnBudgetMs)]);

  try {
    const history = await loadHistory(userId, conversationId, COACH_LIMITS.historyMessages);
    const messages: ChatMessage[] = [
      { role: "system", content: coachSystemPrompt(mode, input.locale) },
      ...history.map((m): ChatMessage =>
        m.role === "USER"
          ? { role: "user", content: m.content }
          : { role: "assistant", content: m.content },
      ),
    ];
    const tools = buildCoachTools({
      userId,
      conversationId,
      mode,
      onEvent: (event) => {
        if (event.type === "suggestion") {
          suggestions.push(event.suggestion);
          send({ type: "suggestion", suggestion: event.suggestion });
        } else {
          send({ type: "status", status: event.type });
        }
      },
    });
    const result = await ai.runTools({
      purpose: `coach.${mode.toLowerCase()}`,
      messages,
      tools,
      maxSteps: COACH_LIMITS.maxSteps,
      temperature: 0.4,
      maxTokens: 1_200,
      signal,
      onStep: (step) => {
        steps = step;
        send({ type: "status", status: "thinking" });
      },
    });
    const content = result.content.trim().slice(0, COACH_LIMITS.replyMaxChars);
    // Réponse vide (sortie inexploitable) : erreur visible, pas de message fantôme.
    if (!content) throw new AiError("invalidOutput");

    const saved = await addMessage(userId, conversationId, "ASSISTANT", content);
    await attachSuggestions(
      userId,
      suggestions.map((s) => s.id),
      saved.id,
    );
    for (const chunk of chunkText(content)) send({ type: "delta", text: chunk });
    send({
      type: "done",
      message: {
        id: saved.id,
        role: "ASSISTANT",
        content,
        createdAt: saved.createdAt.toISOString(),
        suggestions,
      },
      remaining: input.remaining,
    });
    logger.info("coach.turn", {
      userId,
      mode,
      steps,
      suggestions: suggestions.length,
      durationMs: Date.now() - started,
    });
  } catch (error) {
    const code = signal.aborted && !input.signal.aborted ? "aiTimeout" : coachErrorCode(error);
    await discardSuggestions(
      userId,
      suggestions.map((s) => s.id),
    ).catch(() => {});
    // Jamais l'erreur brute : elle pourrait citer un extrait de la conversation.
    logger.warn("coach.turn.failed", {
      userId,
      mode,
      steps,
      code,
      durationMs: Date.now() - started,
    });
    send({ type: "error", code });
  }
}
