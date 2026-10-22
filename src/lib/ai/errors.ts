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
  /**
   * Message d'erreur du fournisseur, tronqué, gardé seulement s'il ne reprend
   * aucun contenu de la requête (voir `openai-compatible.ts`). Journalisable.
   */
  readonly providerMessage?: string;
  /** Type ou code d'erreur du fournisseur (`invalid_request_error`…). */
  readonly providerType?: string;

  constructor(
    code: AiErrorCode,
    options: {
      status?: number;
      retryAfterMs?: number;
      providerMessage?: string;
      providerType?: string;
    } = {},
  ) {
    super(`IA : ${code}${options.status ? ` (HTTP ${options.status})` : ""}`);
    this.name = "AiError";
    this.code = code;
    this.status = options.status;
    this.retryAfterMs = options.retryAfterMs;
    this.providerMessage = options.providerMessage;
    this.providerType = options.providerType;
  }

  get retryable(): boolean {
    return RETRYABLE.has(this.code);
  }
}

export function isAiError(error: unknown): error is AiError {
  return error instanceof AiError;
}

export function errorFromStatus(
  status: number,
  retryAfterMs?: number,
  detail: { providerMessage?: string; providerType?: string } = {},
): AiError {
  if (status === 429) return new AiError("rateLimited", { status, retryAfterMs, ...detail });
  if (status === 408 || status >= 500) {
    return new AiError("unavailable", { status, retryAfterMs, ...detail });
  }
  return new AiError("badRequest", { status, ...detail });
}

/**
 * Refus d'une requête à cause de son CONTENU (400, 413, 422) : une entrée
 * d'embedding peut alors être isolée. Les autres 4xx (clé, droits, modèle
 * inconnu…) concernent toute requête et ne sont jamais imputés à une entrée.
 */
export function isContentRejection(error: AiError): boolean {
  return (
    error.code === "badRequest" &&
    (error.status === 400 || error.status === 413 || error.status === 422)
  );
}
