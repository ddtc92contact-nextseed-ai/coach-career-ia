"use server";

import { AuthError } from "next-auth";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { signIn } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { safeCallbackUrl } from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";

const schema = z.object({
  email: z.email({ error: "invalidEmail" }).max(254, { error: "invalidEmail" }),
  callbackUrl: z.string().optional(),
});

/** `error` est une clé du namespace `auth.login.errors`. */
export type LoginState = { error?: "invalidEmail" | "sendFailed"; email?: string };

export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const locale = await getLocale();
  const parsed = schema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  });
  if (!parsed.success) {
    return { error: "invalidEmail", email: String(formData.get("email") ?? "") };
  }

  try {
    // La langue de la destination fixe aussi celle de l'e-mail envoyé.
    await signIn("email", {
      email: parsed.data.email,
      redirectTo: `/${locale}${safeCallbackUrl(parsed.data.callbackUrl)}`,
      redirect: false,
    });
  } catch (error) {
    if (error instanceof AuthError) {
      logger.warn("auth.magic_link.failed", { type: error.type });
      return { error: "sendFailed", email: parsed.data.email };
    }
    throw error;
  }
  return redirect({ href: "/connexion/verifier", locale });
}
