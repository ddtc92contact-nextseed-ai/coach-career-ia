import "server-only";
import { z } from "zod";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";
import { serverEnv } from "@/lib/env";
import { consume, type RateAction } from "./rate-limit";

/**
 * Outils communs aux routes `/api/account/*` (connexion par mot de passe).
 * Toutes exigent `Content-Type: application/json` : requête « non simple »,
 * qu'un autre site ne peut pas émettre sans CORS (protection CSRF).
 */

const NO_STORE = { "Cache-Control": "private, no-store" };

export function json(body: unknown, status = 200, headers: HeadersInit = {}) {
  return Response.json(body, { status, headers: { ...NO_STORE, ...headers } });
}

export async function readJson(request: Request): Promise<unknown> {
  if (!request.headers.get("content-type")?.startsWith("application/json")) return undefined;
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

export const emailField = z.email().max(254);
export const localeField = z
  .string()
  .optional()
  .transform((v): AppLocale => (isAppLocale(v) ? v : DEFAULT_LOCALE));

/** Première adresse de `X-Forwarded-For` (posée par Traefik), sinon `X-Real-IP`. */
export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** Origine publique pour les liens envoyés par e-mail (`AUTH_URL`, sinon la requête). */
export function publicOrigin(request: Request): string {
  const configured = process.env.AUTH_URL;
  if (configured) return new URL(configured).origin;
  const proto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  if (proto && host) return `${proto}://${host}`;
  return new URL(request.url).origin;
}

/** Même nom de cookie qu'Auth.js : préfixe `__Secure-` en HTTPS. */
export function sessionCookieName(request: Request): string {
  return publicOrigin(request).startsWith("https:")
    ? "__Secure-authjs.session-token"
    : "authjs.session-token";
}

/**
 * Cookie de session. Sans « rester connecté », cookie de session du
 * navigateur (effacé à sa fermeture) ; sinon persistant jusqu'à `expires`.
 */
export function sessionCookie(request: Request, token: string, expires: Date | null): string {
  const secure = publicOrigin(request).startsWith("https:");
  return [
    `${sessionCookieName(request)}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    ...(secure ? ["Secure"] : []),
    ...(expires ? [`Expires=${expires.toUTCString()}`] : []),
  ].join("; ");
}

/** Jeton de session de la requête (pour ne pas fermer la session courante). */
export function currentSessionToken(request: Request): string | undefined {
  const name = sessionCookieName(request);
  for (const part of request.headers.get("cookie")?.split(";") ?? []) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return value.join("=");
  }
  return undefined;
}

export const authSecret = () => serverEnv().AUTH_SECRET;

/**
 * Consomme chaque règle (IP, e-mail…) ; renvoie une réponse 429 générique si
 * l'une est dépassée, `null` sinon.
 */
export async function rateLimited(checks: [RateAction, string][]): Promise<Response | null> {
  const secret = authSecret();
  let retryAfter = 0;
  for (const [action, subject] of checks) {
    const result = await consume(action, subject, secret);
    if (!result.allowed) retryAfter = Math.max(retryAfter, result.retryAfterSeconds);
  }
  return retryAfter > 0 ? tooMany(retryAfter) : null;
}

export function tooMany(retryAfterSeconds: number) {
  return json({ error: "rateLimited", retryAfterSeconds }, 429, {
    "Retry-After": String(retryAfterSeconds),
  });
}
