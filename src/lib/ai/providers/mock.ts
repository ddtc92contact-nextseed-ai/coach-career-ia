import { createHash } from "node:crypto";
import { AiError } from "../errors";
import type {
  AiProvider,
  CallOptions,
  ChatRequest,
  ChatResponse,
  EmbeddingResponse,
  ToolCall,
} from "../types";

/**
 * Fournisseur simulé, déterministe, utilisé par TOUS les tests : aucun appel
 * réseau. Les réponses sont scriptées par le test (`respond`) ; les vecteurs
 * d'embedding sont dérivés d'un hachage du texte.
 */

export type MockReply =
  | string
  | {
      content?: string;
      toolCalls?: ToolCall[];
      finishReason?: ChatResponse["finishReason"];
      /** Échec simulé (délai, fournisseur indisponible…). */
      error?: AiError;
      /** Attente simulée avant de répondre (respecte l'annulation). */
      delayMs?: number;
    };

export type MockResponder = (request: ChatRequest, callIndex: number) => MockReply;

export type MockProvider = AiProvider & {
  /** Requêtes reçues, dans l'ordre (pour les assertions). */
  readonly calls: ChatRequest[];
  readonly embedCalls: string[][];
};

const approxTokens = (text: string) => Math.ceil(text.length / 4);

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** Vecteur unitaire déterministe de `dimensions` composantes. */
export function mockEmbedding(text: string, dimensions = 16): number[] {
  const values: number[] = [];
  for (let block = 0; values.length < dimensions; block++) {
    const digest = createHash("sha256").update(`${block}:${text}`).digest();
    for (let i = 0; i + 1 < digest.length && values.length < dimensions; i += 2) {
      values.push(digest.readUInt16BE(i) / 32767.5 - 1);
    }
  }
  const norm = Math.hypot(...values) || 1;
  return values.map((v) => v / norm);
}

/** Réponses successives : la dernière est répétée si le script est épuisé. */
export function scriptedReplies(...replies: MockReply[]): MockResponder {
  return (_request, index) => replies[Math.min(index, replies.length - 1)]!;
}

export function createMockProvider(
  options: { respond?: MockResponder; dimensions?: number } = {},
): MockProvider {
  const calls: ChatRequest[] = [];
  const embedCalls: string[][] = [];
  const respond: MockResponder =
    options.respond ?? ((request) => (request.responseFormat === "json" ? "{}" : "OK"));

  return {
    name: "mock",
    chatModel: "mock-chat",
    embeddingModel: "mock-embed",
    calls,
    embedCalls,

    async chat(request: ChatRequest, { signal }: CallOptions): Promise<ChatResponse> {
      const index = calls.length;
      calls.push(structuredClone(request));
      const reply = respond(request, index);
      const normalized = typeof reply === "string" ? { content: reply } : reply;
      if (normalized.delayMs) await wait(normalized.delayMs, signal);
      if (signal.aborted) throw signal.reason;
      if (normalized.error) throw normalized.error;
      const content = normalized.content ?? "";
      const toolCalls = normalized.toolCalls ?? [];
      return {
        content,
        toolCalls,
        finishReason: normalized.finishReason ?? (toolCalls.length ? "tool_calls" : "stop"),
        usage: {
          inputTokens: approxTokens(request.messages.map((m) => m.content).join("\n")),
          outputTokens: approxTokens(content),
        },
        model: "mock-chat",
      };
    },

    async embed(texts: string[], { signal }: CallOptions): Promise<EmbeddingResponse> {
      if (signal.aborted) throw signal.reason;
      embedCalls.push([...texts]);
      return {
        vectors: texts.map((text) => mockEmbedding(text, options.dimensions)),
        usage: { inputTokens: approxTokens(texts.join("\n")), outputTokens: 0 },
        model: "mock-embed",
      };
    },
  };
}
