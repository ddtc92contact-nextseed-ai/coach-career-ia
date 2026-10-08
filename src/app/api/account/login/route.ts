import { z } from "zod";
import { createSession, normalizeEmail, verifyCredentials } from "@/lib/auth/accounts";
import {
  authSecret,
  clientIp,
  emailField,
  json,
  rateLimited,
  readJson,
  sessionCookie,
  tooMany,
} from "@/lib/auth/http";
import { clear, consume, peek } from "@/lib/auth/rate-limit";
import { logger } from "@/lib/logger";
import { authHash } from "@/lib/vault/schemas";

const input = z.object({
  email: emailField,
  authHash,
  remember: z.boolean().default(false),
});

/**
 * Connexion par mot de passe : vérifie le hash d'authentification (jamais le
 * mot de passe, qui ne quitte pas le navigateur) puis ouvre une session en
 * base, au même format que celles d'Auth.js (déconnexion, `auth()`, etc.).
 *
 * Réponses : 200 ; 401 `invalidCredentials` (adresse inconnue ou mauvais mot
 * de passe, indiscernables) ; 403 `unverified` (bon mot de passe, adresse non
 * vérifiée) ; 429 `rateLimited` (trop de tentatives ou compte verrouillé
 * après 5 échecs, pour 15 minutes).
 */
export async function POST(request: Request) {
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "invalidCredentials" }, 400);
  const email = normalizeEmail(parsed.data.email);
  const secret = authSecret();

  const limited = await rateLimited([
    ["loginIp", clientIp(request)],
    ["loginEmail", email],
  ]);
  if (limited) return limited;
  const lock = await peek("loginFailures", email, secret);
  if (!lock.allowed) return tooMany(lock.retryAfterSeconds);

  const result = await verifyCredentials(email, parsed.data.authHash);
  if (result.status === "invalid") {
    await consume("loginFailures", email, secret);
    logger.info("auth.login.failed");
    return json({ error: "invalidCredentials" }, 401);
  }
  await clear("loginFailures", email, secret);
  if (result.status === "unverified") return json({ error: "unverified" }, 403);

  const { sessionToken, expires } = await createSession(result.userId);
  logger.info("auth.sign_in", { userId: result.userId, method: "password" });
  return json({ ok: true }, 200, {
    "Set-Cookie": sessionCookie(request, sessionToken, parsed.data.remember ? expires : null),
  });
}
