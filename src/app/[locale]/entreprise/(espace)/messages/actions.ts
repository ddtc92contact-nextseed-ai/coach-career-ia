"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { contactDeps } from "@/lib/contact/server";
import { closeThread, replyInThread } from "@/lib/employer/inbox";
import { requireEmployer } from "@/lib/employer/session";

/**
 * Actions de la messagerie de l'espace entreprise. Chacune commence par
 * `requireEmployer()` (404 pour un non-membre) et n'agit que sur les fils de
 * l'organisation du compte : le fil d'une autre organisation est introuvable.
 */

export type ThreadActionState = {
  ok?: boolean;
  error?: "invalid" | "closed" | "rateLimited";
};

const refresh = () => {
  revalidatePath("/[locale]/entreprise", "layout");
  revalidatePath("/[locale]/app", "layout");
};

export async function replyThreadAction(
  id: string,
  _prev: ThreadActionState,
  formData: FormData,
): Promise<ThreadActionState> {
  const { user, org } = await requireEmployer();
  const deps = contactDeps();
  const result = await replyInThread(
    { userId: user.id, orgId: org.id },
    id,
    { body: formData.get("body") },
    { send: deps.notify, appUrl: deps.appUrl },
  );
  if (!result.ok && result.error === "notFound") notFound();
  refresh();
  return result.ok ? { ok: true } : { error: result.error as ThreadActionState["error"] };
}

export async function closeThreadAction(id: string): Promise<ThreadActionState> {
  const { user, org } = await requireEmployer();
  const deps = contactDeps();
  const result = await closeThread({ userId: user.id, orgId: org.id }, id, {
    send: deps.notify,
    appUrl: deps.appUrl,
  });
  if (!result.ok && result.error === "notFound") notFound();
  refresh();
  return result.ok ? { ok: true } : { error: result.error as ThreadActionState["error"] };
}
