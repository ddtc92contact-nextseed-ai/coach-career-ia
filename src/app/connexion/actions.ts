"use server";

import { AuthError } from "next-auth";
import { z } from "zod";
import { signIn } from "@/auth";
import { safeCallbackUrl } from "@/lib/auth/redirect";
import { logger } from "@/lib/logger";

const schema = z.object({
  email: z.email({ error: "Saisissez une adresse e-mail valide." }).max(254),
  callbackUrl: z.string().optional(),
});

export type LoginState = { error?: string; email?: string };

export async function requestMagicLink(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const parsed = schema.safeParse({
    email: String(formData.get("email") ?? "").trim(),
    callbackUrl: formData.get("callbackUrl") ?? undefined,
  });
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message ?? "Adresse invalide.",
      email: String(formData.get("email") ?? ""),
    };
  }

  try {
    // En cas de succès, signIn redirige (exception NEXT_REDIRECT, relancée).
    await signIn("email", {
      email: parsed.data.email,
      redirectTo: safeCallbackUrl(parsed.data.callbackUrl),
    });
  } catch (error) {
    if (error instanceof AuthError) {
      logger.warn("auth.magic_link.failed", { type: error.type });
      return {
        error: "Impossible d'envoyer le lien pour le moment. Réessayez dans quelques instants.",
        email: parsed.data.email,
      };
    }
    throw error;
  }
  return {};
}
