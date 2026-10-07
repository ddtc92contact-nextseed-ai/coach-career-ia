import "server-only";
import type { AiClient } from "./client";
import { aiClientFromEnv, providerFromEnv } from "./config";

/**
 * Point d'entrée serveur de la couche IA. `server-only` empêche tout import
 * depuis un composant client : les clés ne peuvent pas finir dans le bundle.
 */

let cached: AiClient | undefined;

/** Client partagé (son cache d'embeddings dure le temps du processus). */
export function getAiClient(): AiClient {
  cached ??= aiClientFromEnv();
  return cached;
}

export function isAiConfigured(): boolean {
  try {
    return providerFromEnv() !== null;
  } catch {
    return false;
  }
}
