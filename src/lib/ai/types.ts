/**
 * Types de la couche IA, indépendants du fournisseur (Mistral, endpoint
 * compatible OpenAI type Ollama, simulateur de test).
 *
 * Conçus pour les conversations multi-tours et l'appel d'outils : le futur
 * agent coach s'appuie sur les mêmes messages (`tool`, `toolCalls`).
 */

export type ToolCall = {
  id: string;
  name: string;
  /** Arguments encodés en JSON, tels que renvoyés par le modèle. */
  arguments: string;
};

export type ChatMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; toolCallId: string; name: string; content: string };

export type ToolDefinition = {
  name: string;
  description: string;
  /** Schéma JSON des arguments. */
  parameters: Record<string, unknown>;
};

export type ChatRequest = {
  messages: ChatMessage[];
  /** Libellé fixe de l'usage (`import.extract`…), seul élément journalisé avec les compteurs. */
  purpose: string;
  /** `json` : le modèle doit répondre par un unique objet JSON. */
  responseFormat?: "text" | "json";
  tools?: ToolDefinition[];
  /** `required` : le modèle doit appeler un outil. */
  toolChoice?: "auto" | "none" | "required";
  temperature?: number;
  maxTokens?: number;
};

export type TokenUsage = { inputTokens: number; outputTokens: number };

export type ChatResponse = {
  content: string;
  toolCalls: ToolCall[];
  finishReason: "stop" | "length" | "tool_calls" | "other";
  usage: TokenUsage;
  model: string;
};

export type EmbeddingResponse = {
  vectors: number[][];
  usage: TokenUsage;
  model: string;
};

export type CallOptions = { signal: AbortSignal };

/** Ce qu'un fournisseur doit savoir faire. Les reprises, délais et journaux sont gérés au-dessus. */
export interface AiProvider {
  readonly name: string;
  readonly chatModel: string;
  readonly embeddingModel: string;
  chat(request: ChatRequest, options: CallOptions): Promise<ChatResponse>;
  embed(texts: string[], options: CallOptions): Promise<EmbeddingResponse>;
}
