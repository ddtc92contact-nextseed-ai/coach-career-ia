import { z } from "zod";
import { normalizeEmail, requestPasswordReset } from "@/lib/auth/accounts";
import {
  clientIp,
  emailField,
  json,
  localeField,
  publicOrigin,
  rateLimited,
  readJson,
} from "@/lib/auth/http";

const input = z.object({ email: emailField, locale: localeField });

/** Mot de passe oublié : 202 dans tous les cas valides (pas d'énumération). */
export async function POST(request: Request) {
  const parsed = input.safeParse(await readJson(request));
  if (!parsed.success) return json({ error: "invalidEmail" }, 400);
  const limited = await rateLimited([
    ["mailIp", clientIp(request)],
    ["mailEmail", `reset:${normalizeEmail(parsed.data.email)}`],
  ]);
  if (limited) return limited;
  await requestPasswordReset(parsed.data.email, {
    origin: publicOrigin(request),
    locale: parsed.data.locale,
  });
  return json({ ok: true }, 202);
}
