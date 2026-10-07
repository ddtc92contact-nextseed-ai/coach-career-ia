import { AiError, errorFromStatus } from "../errors";
import type {
  AiProvider,
  CallOptions,
  ChatMessage,
  ChatRequest,
  ChatResponse,
  EmbeddingResponse,
  ToolCall,
} from "../types";

/**
 * Fournisseur pour toute API « chat completions » au format OpenAI : l'API
 * Mistral (`https://api.mistral.ai/v1`) et un Ollama local
 * (`http://127.0.0.1:11434/v1`) parlent ce format, outils et mode JSON compris.
 *
 * Aucune donnée de la requête ou de la réponse n'est journalisée ni reprise
 * dans les erreurs : seuls le statut HTTP et un code remontent.
 */

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export type OpenAiCompatibleOptions = {
  /** Nom journalisé : `mistral`, `openai-compatible`. */
  name: string;
  baseUrl: string;
  apiKey?: string;
  chatModel: string;
  embeddingModel: string;
  fetch?: FetchLike;
};

type WireToolCall = {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: unknown };
};
type WireChatResponse = {
  model?: string;
  choices?: {
    finish_reason?: string | null;
    message?: { content?: unknown; tool_calls?: WireToolCall[] | null };
  }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number };
};
type WireEmbeddingResponse = {
  model?: string;
  data?: { index?: number; embedding?: number[] }[];
  usage?: { prompt_tokens?: number; total_tokens?: number };
};

function toWireMessage(message: ChatMessage) {
  switch (message.role) {
    case "assistant":
      return {
        role: "assistant",
        content: message.content,
        ...(message.toolCalls?.length
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: "function",
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    case "tool":
      return {
        role: "tool",
        tool_call_id: message.toolCallId,
        name: message.name,
        content: message.content,
      };
    default:
      return { role: message.role, content: message.content };
  }
}

/** Contenu texte d'un message, y compris au format « morceaux » (`[{type:"text",text}]`). */
function textContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        part && typeof part === "object" && "text" in part && typeof part.text === "string"
          ? part.text
          : "",
      )
      .join("");
  }
  return "";
}

function finishReason(value: string | null | undefined): ChatResponse["finishReason"] {
  if (value === "stop" || value === "length" || value === "tool_calls") return value;
  return "other";
}

function retryAfterMs(response: Response): number | undefined {
  const header = response.headers.get("retry-after");
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export function createOpenAiCompatibleProvider(options: OpenAiCompatibleOptions): AiProvider {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const doFetch: FetchLike = options.fetch ?? ((input, init) => fetch(input, init));

  async function post<T>(path: string, body: unknown, { signal }: CallOptions): Promise<T> {
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          ...(options.apiKey ? { Authorization: `Bearer ${options.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason;
      // Erreur réseau : le détail (hôte, cause) n'est pas propagé.
      void error;
      throw new AiError("unavailable");
    }
    if (!response.ok) {
      // Le corps d'erreur peut citer la requête : il est ignoré.
      await response.body?.cancel().catch(() => {});
      throw errorFromStatus(response.status, retryAfterMs(response));
    }
    try {
      return (await response.json()) as T;
    } catch {
      if (signal.aborted) throw signal.reason;
      throw new AiError("unavailable", { status: response.status });
    }
  }

  return {
    name: options.name,
    chatModel: options.chatModel,
    embeddingModel: options.embeddingModel,

    async chat(request: ChatRequest, callOptions: CallOptions): Promise<ChatResponse> {
      const body = {
        model: options.chatModel,
        messages: request.messages.map(toWireMessage),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
        ...(request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        ...(request.tools?.length
          ? {
              tools: request.tools.map((tool) => ({
                type: "function",
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
              // Mistral nomme `any` ce que l'API OpenAI nomme `required`.
              tool_choice:
                request.toolChoice === "required" && options.name === "mistral"
                  ? "any"
                  : (request.toolChoice ?? "auto"),
            }
          : {}),
      };
      const data = await post<WireChatResponse>("/chat/completions", body, callOptions);
      const choice = data.choices?.[0];
      if (!choice?.message) throw new AiError("invalidOutput");
      const toolCalls: ToolCall[] = (choice.message.tool_calls ?? []).flatMap((call, index) =>
        call.function?.name
          ? [
              {
                id: call.id || `call_${index}`,
                name: call.function.name,
                arguments:
                  typeof call.function.arguments === "string"
                    ? call.function.arguments
                    : JSON.stringify(call.function.arguments ?? {}),
              },
            ]
          : [],
      );
      return {
        content: textContent(choice.message.content),
        toolCalls,
        finishReason: toolCalls.length ? "tool_calls" : finishReason(choice.finish_reason),
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? 0,
          outputTokens: data.usage?.completion_tokens ?? 0,
        },
        model: data.model ?? options.chatModel,
      };
    },

    async embed(texts: string[], callOptions: CallOptions): Promise<EmbeddingResponse> {
      const data = await post<WireEmbeddingResponse>(
        "/embeddings",
        { model: options.embeddingModel, input: texts },
        callOptions,
      );
      const rows = [...(data.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      if (rows.length !== texts.length || rows.some((row) => !Array.isArray(row.embedding))) {
        throw new AiError("invalidOutput");
      }
      return {
        vectors: rows.map((row) => row.embedding!),
        usage: {
          inputTokens: data.usage?.prompt_tokens ?? data.usage?.total_tokens ?? 0,
          outputTokens: 0,
        },
        model: data.model ?? options.embeddingModel,
      };
    },
  };
}
