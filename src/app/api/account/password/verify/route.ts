import { z } from "zod";
import { checkPassword } from "@/lib/auth/accounts";
import { json, rateLimited, readJson } from "@/lib/auth/http";
import { getCurrentUser } from "@/lib/auth/session";
import { authHash } from "@/lib/vault/schemas";

const input = z.object({ authHash });

/**
 * Vérifie le mot de passe du compte connecté (hash d'authentification) avant
 * que le navigateur n'enveloppe le coffre avec la clé qui en découle : une
 * faute de frappe ne doit jamais produire un coffre illisible.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return json(null, 401);
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "invalidInput" }, 400);
  const limited = await rateLimited([["passwordUser", user.id]]);
  if (limited) return limited;
  if (!(await checkPassword(user.id, parsed.data.authHash))) {
    return json({ error: "invalidCurrent" }, 403);
  }
  return json({ ok: true });
}
