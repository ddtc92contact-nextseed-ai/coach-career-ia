import { isAiError, type AiErrorCode } from "@/lib/ai/errors";
import type { ImportErrorCode } from "./shared";

/** Erreur d'import, identifiée par un code traduit dans l'interface. */
export class ImportError extends Error {
  readonly code: ImportErrorCode;
  constructor(code: ImportErrorCode) {
    super(`Import : ${code}`);
    this.name = "ImportError";
    this.code = code;
  }
}

const FROM_AI: Record<AiErrorCode, ImportErrorCode> = {
  notConfigured: "aiNotConfigured",
  timeout: "aiTimeout",
  aborted: "aiTimeout",
  unavailable: "aiUnavailable",
  rateLimited: "aiRateLimited",
  badRequest: "aiUnavailable",
  invalidOutput: "aiInvalidOutput",
};

/** Code affichable pour toute erreur levée par le pipeline. */
export function importErrorCode(error: unknown): ImportErrorCode {
  if (error instanceof ImportError) return error.code;
  if (isAiError(error)) return FROM_AI[error.code];
  return "unknown";
}
