"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/career/repository";
import {
  acceptSuggestion,
  createConversation,
  deleteConversation,
  rejectSuggestion,
  type DecisionResult,
} from "@/lib/coach/repository";
import { COACH_MODES } from "@/lib/coach/shared";
import { logger } from "@/lib/logger";

/**
 * Actions du coach : authentification, validation, puis accès TOUJOURS
 * filtré par l'utilisateur courant (`src/lib/coach/repository.ts`).
 */

const id = z.string().min(1).max(64);

export async function startConversation(mode: unknown) {
  const user = await requireUser();
  const parsed = z.enum(COACH_MODES).safeParse(mode);
  if (!parsed.success) return;
  const conversation = await createConversation(user.id, parsed.data);
  logger.info("coach.conversation.created", { userId: user.id, mode: parsed.data });
  redirect({ href: `/app/coach/${conversation.id}`, locale: await getLocale() });
}

export async function removeConversation(conversationId: string, back = false) {
  const user = await requireUser();
  try {
    await deleteConversation(user.id, id.parse(conversationId));
  } catch (error) {
    if (!(error instanceof NotFoundError) && !(error instanceof z.ZodError)) throw error;
  }
  revalidatePath("/[locale]/app/coach", "layout");
  if (back) redirect({ href: "/app/coach", locale: await getLocale() });
}

async function decide(run: () => Promise<DecisionResult>): Promise<DecisionResult> {
  try {
    const result = await run();
    if (result.ok) revalidatePath("/[locale]/app", "layout");
    return result;
  } catch (error) {
    if (error instanceof NotFoundError || error instanceof z.ZodError) {
      return { ok: false, errors: { _form: "notFound" } };
    }
    throw error;
  }
}

/** Le candidat accepte une suggestion (telle quelle, ou modifiée : `edited`). */
export async function acceptCoachSuggestion(suggestionId: string, edited?: unknown) {
  const user = await requireUser();
  const result = await decide(() => acceptSuggestion(user.id, id.parse(suggestionId), edited));
  logger.info("coach.suggestion.decided", {
    userId: user.id,
    decision: "accepted",
    ok: result.ok,
    edited: edited !== undefined,
  });
  return result;
}

export async function rejectCoachSuggestion(suggestionId: string) {
  const user = await requireUser();
  return decide(() => rejectSuggestion(user.id, id.parse(suggestionId)));
}
