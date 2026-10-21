import "server-only";
import { createRateLimiter } from "@/lib/import/rate-limit";
import { RADAR_PRODUCT } from "./config";
import { HttpClient } from "./http";
import { HOST_INTERVALS } from "./job";

/**
 * Client HTTP de l'application pour valider les boards ajoutés par les
 * candidats : mêmes règles de politesse que le radar (User-Agent avec
 * contact, robots.txt, `RADAR_MIN_INTERVAL_MS` et intervalles par hôte), mais
 * délais courts — le candidat attend la réponse. Partagé entre requêtes pour
 * que le débit par hôte vaille pour tous les candidats.
 */
let client: HttpClient | null | undefined;

export function followHttpClient(env: NodeJS.ProcessEnv = process.env): HttpClient | null {
  if (client !== undefined) return client;
  const contact = [env.RADAR_CONTACT, env.AUTH_URL]
    .map((c) => c?.trim())
    .find((c) => c && /^\S{5,}$/.test(c) && !/[()]/.test(c));
  if (!contact) {
    client = null;
    return client;
  }
  const minIntervalMs = Math.max(250, Number.parseInt(env.RADAR_MIN_INTERVAL_MS ?? "", 10) || 1000);
  client = new HttpClient({
    userAgent: `${RADAR_PRODUCT} (+${contact})`,
    minIntervalMs,
    hostIntervals: Object.fromEntries(
      Object.entries(HOST_INTERVALS).map(([host, ms]) => [host, Math.max(ms, minIntervalMs)]),
    ),
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 5000,
    timeoutMs: 10_000,
  });
  return client;
}

/** Validations de boards par candidat : 10 par quart d'heure. */
export const followProbeLimiter = createRateLimiter({ max: 10, windowMs: 15 * 60 * 1000 });
