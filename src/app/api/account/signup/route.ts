import { z } from "zod";
import { normalizeEmail, signUp } from "@/lib/auth/accounts";
import {
  clientIp,
  emailField,
  json,
  localeField,
  publicOrigin,
  rateLimited,
  readJson,
} from "@/lib/auth/http";
import { accountKdfParams, authHash } from "@/lib/vault/schemas";

const input = z.object({
  email: emailField,
  authHash,
  kdf: accountKdfParams,
  acceptTerms: z.literal(true),
  locale: localeField,
  callbackUrl: z.string().max(500).optional(),
});

/**
 * Inscription : 202 dans tous les cas valides, que l'adresse ait déjà un
 * compte ou non (le titulaire d'un compte existant est prévenu par e-mail).
 */
export async function POST(request: Request) {
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "invalidInput" }, 400);
  const limited = await rateLimited([
    ["signupIp", clientIp(request)],
    ["signupEmail", normalizeEmail(parsed.data.email)],
  ]);
  if (limited) return limited;
  await signUp(parsed.data, {
    origin: publicOrigin(request),
    locale: parsed.data.locale,
    callbackUrl: parsed.data.callbackUrl,
  });
  return json({ ok: true }, 202);
}
