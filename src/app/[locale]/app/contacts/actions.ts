"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/career/repository";
import { contactDailyLimit } from "@/lib/contact/config";
import {
  approveDraft,
  discardContact,
  markSubmitted,
  sendContact,
  startContact,
  updateDraft,
  type ContactError,
} from "@/lib/contact/repository";
import { contactDeps } from "@/lib/contact/server";
import { revokeHandover } from "@/lib/handover/repository";

/**
 * Actions de prise de contact. Chacune repart de l'utilisateur courant :
 * l'identifiant d'un contact ou d'une correspondance d'une autre personne est
 * traité comme inexistant (404). Rien n'est envoyé sans l'action explicite
 * « Envoyer » sur un brouillon approuvé.
 */

export type ContactActionState = {
  ok?: "saved" | "approved" | "sent";
  error?: ContactError | "invalid";
  excerpt?: string;
  limit?: number;
};

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

function failure(result: {
  error: ContactError;
  issues?: { excerpt?: string }[];
}): ContactActionState {
  return {
    error: result.error,
    excerpt: result.issues?.find((i) => i.excerpt)?.excerpt,
    limit: result.error === "quota" ? contactDailyLimit() : undefined,
  };
}

const refresh = () => revalidatePath("/[locale]/app", "layout");

/** « Contacter cette entreprise » depuis une opportunité. */
export async function startContactAction(matchId: string) {
  const user = await requireUser();
  const result = await guard(() => startContact(user.id, matchId, { ai: contactDeps().ai }));
  const locale = await getLocale();
  if (!result.ok) {
    return redirect({
      href: `/app/opportunites/${encodeURIComponent(matchId)}?contact=${result.error}#contacter`,
      locale,
    });
  }
  refresh();
  return redirect({ href: `/app/contacts/${result.id}`, locale });
}

export async function saveDraftAction(
  id: string,
  _prev: ContactActionState,
  formData: FormData,
): Promise<ContactActionState> {
  const user = await requireUser();
  const result = await guard(() =>
    updateDraft(user.id, id, { subject: formData.get("subject"), body: formData.get("body") }),
  );
  refresh();
  if (!result.ok) return result.error === "invalid" ? { error: "invalid" } : failure(result);
  return { ok: "saved" };
}

export async function approveDraftAction(id: string): Promise<ContactActionState> {
  const user = await requireUser();
  const result = await guard(() => approveDraft(user.id, id, { appUrl: contactDeps().appUrl }));
  refresh();
  return result.ok ? { ok: "approved" } : failure(result);
}

export async function sendContactAction(id: string): Promise<ContactActionState> {
  const user = await requireUser();
  const deps = contactDeps();
  const result = await guard(() =>
    sendContact(user.id, id, { send: deps.send, appUrl: deps.appUrl }),
  );
  refresh();
  return result.ok ? { ok: "sent" } : failure(result);
}

export async function markSubmittedAction(id: string) {
  const user = await requireUser();
  await guard(() => markSubmitted(user.id, id));
  refresh();
}

export async function discardContactAction(id: string) {
  const user = await requireUser();
  await guard(() => discardContact(user.id, id));
  refresh();
  return redirect({ href: "/app/contacts", locale: await getLocale() });
}

/** Révocation de la levée d'anonymat d'un fil : lien coupé, identité révélée effacée. */
export async function revokeHandoverAction(id: string) {
  const user = await requireUser();
  await guard(() => revokeHandover(user.id, id));
  refresh();
}
