"use server";

import { contactDeps } from "@/lib/contact/server";
import { recordReply } from "@/lib/contact/repository";

export type ReplyState = { ok?: boolean; error?: "invalid" | "rateLimited" | "notFound" };

/** Réponse d'une entreprise (sans connexion : seul un jeton actif, lié à un contact envoyé, l'autorise). */
export async function submitReply(
  token: string,
  _prev: ReplyState,
  formData: FormData,
): Promise<ReplyState> {
  const deps = contactDeps();
  const result = await recordReply(
    token,
    { body: formData.get("body") },
    { send: deps.notify, appUrl: deps.appUrl },
  );
  return result.ok ? { ok: true } : { error: result.error };
}
