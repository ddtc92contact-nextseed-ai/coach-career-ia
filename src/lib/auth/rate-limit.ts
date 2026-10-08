import "server-only";
import { createHmac } from "node:crypto";
import { db } from "@/lib/db";

/**
 * Limitation de débit en base (fenêtre fixe), partagée entre instances. La
 * clé stockée est un HMAC de l'action et de l'identifiant (IP ou e-mail) :
 * la table ne contient ni adresse IP ni adresse e-mail.
 */

export type RateRule = { limit: number; windowSeconds: number };
export type RateResult = { allowed: boolean; retryAfterSeconds: number };

/** Règles par action et par dimension (IP, e-mail). */
export const RATE_RULES = {
  /** Tentatives de connexion. */
  loginIp: { limit: 30, windowSeconds: 15 * 60 },
  loginEmail: { limit: 10, windowSeconds: 15 * 60 },
  /** Échecs consécutifs pour une adresse : au-delà, compte verrouillé jusqu'à la fin de la fenêtre. */
  loginFailures: { limit: 5, windowSeconds: 15 * 60 },
  /** Paramètres de dérivation demandés avant chaque connexion. */
  preloginIp: { limit: 60, windowSeconds: 15 * 60 },
  signupIp: { limit: 10, windowSeconds: 60 * 60 },
  signupEmail: { limit: 3, windowSeconds: 60 * 60 },
  /** Demandes d'e-mail de réinitialisation ou de vérification. */
  mailIp: { limit: 10, windowSeconds: 60 * 60 },
  mailEmail: { limit: 3, windowSeconds: 60 * 60 },
  /** Réinitialisation (jeton) et changement de mot de passe. */
  resetIp: { limit: 20, windowSeconds: 60 * 60 },
  passwordUser: { limit: 10, windowSeconds: 15 * 60 },
} satisfies Record<string, RateRule>;

export type RateAction = keyof typeof RATE_RULES;

export function rateKey(action: RateAction, subject: string, secret: string): string {
  return createHmac("sha256", secret).update(`${action}:${subject}`).digest("base64url");
}

/** Compte une tentative et indique si elle reste sous la limite. */
export async function consume(
  action: RateAction,
  subject: string,
  secret: string,
  now: Date = new Date(),
): Promise<RateResult> {
  const { limit, windowSeconds } = RATE_RULES[action];
  const key = rateKey(action, subject, secret);
  const windowFloor = new Date(now.getTime() - windowSeconds * 1000);
  const [row] = await db.$queryRaw<{ count: number; window_start: Date }[]>`
    INSERT INTO rate_limits (key, window_start, count) VALUES (${key}, ${now}, 1)
    ON CONFLICT (key) DO UPDATE SET
      count = CASE WHEN rate_limits.window_start <= ${windowFloor} THEN 1 ELSE rate_limits.count + 1 END,
      window_start = CASE WHEN rate_limits.window_start <= ${windowFloor} THEN ${now} ELSE rate_limits.window_start END
    RETURNING count, window_start`;
  return result(row!.count, row!.window_start, limit, windowSeconds, now);
}

/** Lit un compteur sans l'incrémenter (verrouillage après échecs). */
export async function peek(
  action: RateAction,
  subject: string,
  secret: string,
  now: Date = new Date(),
): Promise<RateResult> {
  const { limit, windowSeconds } = RATE_RULES[action];
  const row = await db.rateLimit.findUnique({ where: { key: rateKey(action, subject, secret) } });
  if (!row || row.windowStart.getTime() <= now.getTime() - windowSeconds * 1000) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  // Atteindre la limite suffit à bloquer la tentative suivante.
  return result(row.count + 1, row.windowStart, limit, windowSeconds, now);
}

export async function clear(action: RateAction, subject: string, secret: string): Promise<void> {
  await db.rateLimit.deleteMany({ where: { key: rateKey(action, subject, secret) } });
}

function result(
  count: number,
  windowStart: Date,
  limit: number,
  windowSeconds: number,
  now: Date,
): RateResult {
  if (count <= limit) return { allowed: true, retryAfterSeconds: 0 };
  const end = windowStart.getTime() + windowSeconds * 1000;
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((end - now.getTime()) / 1000)),
  };
}
