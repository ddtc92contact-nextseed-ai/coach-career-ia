import { z } from "zod";
import { AiClient, createAiClient } from "./client";
import { AiError } from "./errors";
import { createMockProvider } from "./providers/mock";
import { createOpenAiCompatibleProvider, type FetchLike } from "./providers/openai-compatible";
import type { AiProvider } from "./types";

/**
 * Choix du fournisseur d'après l'environnement (secrets lus ici seulement,
 * côté serveur) :
 * - `AI_PROVIDER=mistral` (défaut) : API Mistral, `MISTRAL_API_KEY` ;
 * - `AI_PROVIDER=openai-compatible` : endpoint au format OpenAI, par ex. un
 *   Ollama local (`OPENAI_COMPAT_BASE_URL=http://127.0.0.1:11434/v1`) ;
 * - `AI_PROVIDER=mock` : simulateur déterministe.
 * Sous Vitest, le simulateur est TOUJOURS utilisé : un test ne peut pas
 * appeler un vrai modèle.
 */

const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().optional());
const positiveInt = (fallback: number) =>
  z.preprocess((v) => (v === "" ? undefined : v), z.coerce.number().int().min(0).default(fallback));

const aiEnvSchema = z.object({
  AI_PROVIDER: z.preprocess(
    (v) => (v === "" ? undefined : v),
    z.enum(["mistral", "openai-compatible", "mock"]).default("mistral"),
  ),
  MISTRAL_API_KEY: optional,
  MISTRAL_BASE_URL: optional,
  MISTRAL_CHAT_MODEL: optional,
  MISTRAL_EMBED_MODEL: optional,
  OPENAI_COMPAT_BASE_URL: optional,
  OPENAI_COMPAT_API_KEY: optional,
  OPENAI_COMPAT_CHAT_MODEL: optional,
  OPENAI_COMPAT_EMBED_MODEL: optional,
  AI_TIMEOUT_MS: positiveInt(45_000),
  AI_MAX_RETRIES: positiveInt(2),
});
export type AiEnv = z.infer<typeof aiEnvSchema>;

export function readAiEnv(env: Record<string, string | undefined> = process.env): AiEnv {
  const parsed = aiEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuration IA invalide : ${names}`);
  }
  return parsed.data;
}

const isTestRun = (env: Record<string, string | undefined>) =>
  Boolean(env.VITEST) || env.NODE_ENV === "test";

/** Fournisseur configuré, ou `null` s'il manque une clé / une URL. */
export function providerFromEnv(
  env: Record<string, string | undefined> = process.env,
  fetch?: FetchLike,
): AiProvider | null {
  if (isTestRun(env)) return createMockProvider();
  const config = readAiEnv(env);
  switch (config.AI_PROVIDER) {
    case "mock":
      return createMockProvider();
    case "openai-compatible":
      if (!config.OPENAI_COMPAT_BASE_URL || !config.OPENAI_COMPAT_CHAT_MODEL) return null;
      return createOpenAiCompatibleProvider({
        name: "openai-compatible",
        baseUrl: config.OPENAI_COMPAT_BASE_URL,
        apiKey: config.OPENAI_COMPAT_API_KEY,
        chatModel: config.OPENAI_COMPAT_CHAT_MODEL,
        embeddingModel: config.OPENAI_COMPAT_EMBED_MODEL ?? "nomic-embed-text",
        fetch,
      });
    case "mistral":
      if (!config.MISTRAL_API_KEY) return null;
      return createOpenAiCompatibleProvider({
        name: "mistral",
        baseUrl: config.MISTRAL_BASE_URL ?? "https://api.mistral.ai/v1",
        apiKey: config.MISTRAL_API_KEY,
        chatModel: config.MISTRAL_CHAT_MODEL ?? "mistral-small-latest",
        embeddingModel: config.MISTRAL_EMBED_MODEL ?? "mistral-embed",
        fetch,
      });
  }
}

/** Client prêt à l'emploi ; `notConfigured` si aucun fournisseur n'est utilisable. */
export function aiClientFromEnv(env: Record<string, string | undefined> = process.env): AiClient {
  const provider = providerFromEnv(env);
  if (!provider) throw new AiError("notConfigured");
  const config = isTestRun(env) ? undefined : readAiEnv(env);
  return createAiClient({
    provider,
    timeoutMs: config?.AI_TIMEOUT_MS,
    maxRetries: config?.AI_MAX_RETRIES,
  });
}
