/** Couche IA indépendante du fournisseur. Côté serveur : `getAiClient()` (`./server`). */
export { AiClient, createAiClient, stripCodeFence } from "./client";
export type {
  AiClientOptions,
  CallSettings,
  GenerateObjectRequest,
  GenerateObjectResult,
  RunToolsRequest,
  RunToolsResult,
  Tool,
} from "./client";
export { AI_ERROR_CODES, AiError, isAiError, type AiErrorCode } from "./errors";
export { languageInstruction, languageName } from "./locale";
export { createMockProvider, mockEmbedding, scriptedReplies } from "./providers/mock";
export type { MockProvider, MockReply, MockResponder } from "./providers/mock";
export { createOpenAiCompatibleProvider } from "./providers/openai-compatible";
export type * from "./types";
