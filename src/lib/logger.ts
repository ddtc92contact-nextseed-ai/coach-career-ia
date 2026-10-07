/**
 * Logger structuré (une ligne JSON par événement) qui ne laisse jamais passer
 * de données personnelles :
 * - on journalise un nom d'événement et un contexte plat de valeurs simples ;
 * - les clés sensibles (email, nom, téléphone, jeton, corps de requête…) sont
 *   masquées ;
 * - les adresses e-mail, numéros de téléphone et jetons repérés dans les
 *   chaînes sont masqués ;
 * - objets et tableaux (corps de requête, entités) ne sont jamais sérialisés.
 */

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogContext = Record<string, unknown>;

const LEVELS: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const REDACTED = "[masqué]";
const OMITTED = "[objet omis]";
const MAX_STRING = 300;

const SENSITIVE_KEY =
  /e-?mail|name|nom|phone|tel|address|adresse|password|passwd|secret|token|cookie|authorization|auth|session|body|payload|content|ssn|iban|employer|employeur|birth|naissance|ip$/i;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE = /(?:\+|00)\d{1,3}[\s.-]?\d(?:[\s.-]?\d{2}){4}\b|\b0\d(?:[\s.-]?\d{2}){4}\b/g;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]+/gi;
const URL_QUERY = /(https?:\/\/[^\s?#]+)\?[^\s#]*/gi;

export function scrubString(value: string): string {
  const scrubbed = value
    .replace(URL_QUERY, `$1?${REDACTED}`)
    .replace(EMAIL, REDACTED)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(PHONE, REDACTED);
  return scrubbed.length > MAX_STRING ? `${scrubbed.slice(0, MAX_STRING)}…` : scrubbed;
}

function sanitizeValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (SENSITIVE_KEY.test(key)) return REDACTED;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    const code = (value as { code?: unknown }).code;
    return {
      name: value.name,
      message: scrubString(value.message),
      ...(typeof code === "string" || typeof code === "number" ? { code } : {}),
    };
  }
  return OMITTED;
}

export function sanitizeContext(context: LogContext = {}): LogContext {
  const safe: LogContext = {};
  for (const [key, value] of Object.entries(context)) {
    safe[key] = sanitizeValue(key, value);
  }
  return safe;
}

type Writer = (level: LogLevel, line: string) => void;

const defaultWriter: Writer = (level, line) => {
  if (level === "error" || level === "warn") console.error(line);
  else console.log(line);
};

function envLevel(): LogLevel {
  const raw = process.env.LOG_LEVEL;
  if (raw && raw in LEVELS) return raw as LogLevel;
  return process.env.NODE_ENV === "production" ? "info" : "debug";
}

export function createLogger(options: { level?: LogLevel; write?: Writer } = {}) {
  const write = options.write ?? defaultWriter;
  const log = (level: LogLevel, event: string, context?: LogContext) => {
    if (LEVELS[level] < LEVELS[options.level ?? envLevel()]) return;
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      level,
      event: scrubString(event),
      ...sanitizeContext(context),
    });
    write(level, line);
  };
  return {
    debug: (event: string, context?: LogContext) => log("debug", event, context),
    info: (event: string, context?: LogContext) => log("info", event, context),
    warn: (event: string, context?: LogContext) => log("warn", event, context),
    error: (event: string, context?: LogContext) => log("error", event, context),
  };
}

export type Logger = ReturnType<typeof createLogger>;

export const logger: Logger = createLogger();
