import { z } from "zod";
import { resetPassword } from "@/lib/auth/accounts";
import { clientIp, json, rateLimited, readJson } from "@/lib/auth/http";
import { accountKdfParams, authHash } from "@/lib/vault/schemas";

const input = z.object({ token: z.string().min(1).max(100), authHash, kdf: accountKdfParams });

/**
 * Nouveau mot de passe via le lien reçu par e-mail (jeton à usage unique,
 * 30 minutes). 400 `invalidToken` si le jeton est inconnu, expiré ou utilisé.
 */
export async function POST(request: Request) {
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "invalidInput" }, 400);
  const limited = await rateLimited([["resetIp", clientIp(request)]]);
  if (limited) return limited;
  const userId = await resetPassword(parsed.data);
  if (!userId) return json({ error: "invalidToken" }, 400);
  return json({ ok: true });
}
