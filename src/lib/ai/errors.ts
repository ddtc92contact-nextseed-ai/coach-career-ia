/**
 * Erreurs de la couche IA, sous forme de CODES : l'interface les traduit, et
 * aucun contenu (prompt, réponse du fournisseur) n'est repris dans le message.
 */
export const AI_ERROR_CODES = [
  /** Aucun fournisseur configuré (clé absente…). */
  "notConfigured",
  /** Délai dépassé. */
  "timeout",
  /** Fournisseur injoignable ou en erreur (5xx, réseau). */
  "unavailable",
  /** Quota ou débit dépassé (429). */
  "rateLimited",
  /** Requête refusée (4xx hors 429) : bug ou configuration. */
  "badRequest",
  /** Réponse non conforme au schéma attendu, même après réparation. */
  "invalidOutput",
  /** Annulé par l'appelant. */
  "aborted",
] as const;
export type AiErrorCode = (typeof AI_ERROR_CODES)[number];

const RETRYABLE: ReadonlySet<AiErrorCode> = new Set(["timeout", "unavailable", "rateLimited"]);

export class AiError extends Error {
  readonly code: AiErrorCode;
  readonly status?: number;
  /** Délai suggéré par le fournisseur (`Retry-After`), en ms. */
  readonly retryAfterMs?: number;

  constructor(code: AiErrorCode, options: { status?: number; retryAfterMs?: number } = {}) {
    super(`IA : ${code}${options.status ? ` (HTTP ${options.status})` : ""}`);
    this.name = "AiError";
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

export function errorFromStatus(status: number, retryAfterMs?: number): AiError {
  if (status === 429) return new AiError("rateLimited", { status, retryAfterMs });
  if (status === 408 || status >= 500) return new AiError("unavailable", { status, retryAfterMs });
  return new AiError("badRequest", { status });
}
