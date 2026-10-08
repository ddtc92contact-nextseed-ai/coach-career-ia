import { z } from "zod";
import { loginKdf } from "@/lib/auth/accounts";
import { authSecret, clientIp, emailField, json, rateLimited, readJson } from "@/lib/auth/http";

const input = z.object({ email: emailField });

/**
 * Avant la connexion : paramètres de dérivation du mot de passe pour cette
 * adresse (sel du compte, ou sel factice stable si l'adresse n'a pas de
 * compte à mot de passe : la réponse ne révèle rien).
 */
export async function POST(request: Request) {
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "invalidEmail" }, 400);
  const limited = await rateLimited([["preloginIp", clientIp(request)]]);
  if (limited) return limited;
  return json({ kdf: await loginKdf(parsed.data.email, authSecret()) });
}
