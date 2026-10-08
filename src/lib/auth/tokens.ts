import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { AuthTokenKind } from "@/generated/prisma/enums";
import { db } from "@/lib/db";

/**
 * Jetons à usage unique envoyés par e-mail. Le jeton (32 octets aléatoires)
 * ne figure que dans le lien ; la base n'en garde que le SHA-256. Émettre un
 * jeton invalide les précédents du même type.
 */

export const TOKEN_TTL_SECONDS: Record<AuthTokenKind, number> = {
  VERIFY_EMAIL: 24 * 60 * 60,
  RESET_PASSWORD: 30 * 60,
};

const hashToken = (token: string) => createHash("sha256").update(token).digest("base64url");

export async function issueToken(
  userId: string,
  kind: AuthTokenKind,
  now: Date = new Date(),
): Promise<string> {
  const token = randomBytes(32).toString("base64url");
  await db.$transaction([
    db.authToken.deleteMany({ where: { userId, kind } }),
    db.authToken.create({
      data: {
        userId,
        kind,
        tokenHash: hashToken(token),
        expiresAt: new Date(now.getTime() + TOKEN_TTL_SECONDS[kind] * 1000),
      },
    }),
  ]);
  return token;
}

/** Jeton valide (non expiré, non utilisé) ? Sans le consommer. */
export async function peekToken(
  token: string,
  kind: AuthTokenKind,
  now: Date = new Date(),
): Promise<boolean> {
  if (!token || token.length > 100) return false;
  const count = await db.authToken.count({
    where: { tokenHash: hashToken(token), kind, usedAt: null, expiresAt: { gt: now } },
  });
  return count === 1;
}

/**
 * Consomme le jeton de façon atomique : renvoie l'utilisateur, ou `null` si
 * le jeton est inconnu, expiré ou déjà utilisé.
 */
export async function consumeToken(
  token: string,
  kind: AuthTokenKind,
  now: Date = new Date(),
): Promise<string | null> {
  if (!token || token.length > 100) return null;
  const tokenHash = hashToken(token);
  const { count } = await db.authToken.updateMany({
    where: { tokenHash, kind, usedAt: null, expiresAt: { gt: now } },
    data: { usedAt: now },
  });
  if (count !== 1) return null;
  const row = await db.authToken.findUnique({ where: { tokenHash }, select: { userId: true } });
  return row?.userId ?? null;
}
