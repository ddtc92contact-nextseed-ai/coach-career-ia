import { z } from "zod";
import { accountKdf, setPassword } from "@/lib/auth/accounts";
import { currentSessionToken, json, rateLimited, readJson } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { accountKdfParams, authHash, wrappedKey } from "@/lib/vault/schemas";

const input = z.object({
  currentAuthHash: authHash.optional(),
  authHash,
  kdf: accountKdfParams,
  vault: z.object({ revision: z.number().int().min(0), wrappedKey }).optional(),
});

/** Paramètres de dérivation du compte connecté (`kdf: null` sans mot de passe). */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return json(null, 401);
  return json({ kdf: await accountKdf(user.id) });
}

/**
 * Définit (compte à lien magique) ou change le mot de passe. Le coffre lié à
 * l'ancien mot de passe est ré-enveloppé dans le navigateur et enregistré dans
 * la même transaction. 403 `invalidCurrent`, 409 `vaultConflict`.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json(null, 401);
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "invalidInput" }, 400);
  const limited = await rateLimited([["passwordUser", user.id]]);
  if (limited) return limited;
  const result = await setPassword(user.id, parsed.data, currentSessionToken(request));
  if (!result.ok) {
    return json({ error: result.reason }, result.reason === "vaultConflict" ? 409 : 403);
  }
  return json({ ok: true, vaultRevision: result.vaultRevision });
}
