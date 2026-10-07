import { createHash, randomBytes } from "node:crypto";

/**
 * Jetons des liens publics (`/p/<jeton>`) : 32 octets aléatoires (base64url,
 * 43 caractères), impossibles à deviner. Seule leur empreinte SHA-256 est
 * stockée : une fuite de la base ne donne accès à aucune carte.
 */

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
export const DEFAULT_CARD_LINK_TTL_DAYS = 30;
const DAY_MS = 24 * 3_600_000;

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("base64url");
}

export function newToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

export function isTokenShape(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/** Durée de validité d'un lien (`CARD_LINK_TTL_DAYS`, 30 jours par défaut, 1 à 365). */
export function cardLinkTtlDays(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.CARD_LINK_TTL_DAYS?.trim());
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : DEFAULT_CARD_LINK_TTL_DAYS;
}

export function linkExpiry(now: Date, ttlDays: number): Date {
  return new Date(now.getTime() + ttlDays * DAY_MS);
}

/** Un lien est utilisable s'il n'est ni révoqué ni expiré. */
export function isLinkActive(
  link: { expiresAt: Date; revokedAt: Date | null },
  now: Date,
): boolean {
  return link.revokedAt === null && link.expiresAt.getTime() > now.getTime();
}

/** Chemin public de la carte (et de la page de réponse). */
export const cardPath = (locale: string, token: string) => `/${locale}/p/${token}`;
export const replyPath = (locale: string, token: string) => `/${locale}/p/${token}/repondre`;
