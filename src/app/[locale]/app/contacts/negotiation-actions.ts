"use server";

import { revalidatePath } from "next/cache";
import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth/session";
import { getEntitlements } from "@/lib/billing/server";
import { NotFoundError } from "@/lib/career/repository";
import { contactDailyLimit } from "@/lib/contact/config";
import { contactDeps } from "@/lib/contact/server";
import type { NegotiationIssue } from "@/lib/negotiation/check";
import type { MandateField } from "@/lib/negotiation/mandate";
import { mandateFromForm } from "@/lib/negotiation/mandate";
import {
  approveMessage,
  discardMessage,
  generateDraft,
  markTransmitted,
  saveMandate,
  sendMessage,
  setOutcome,
  updateMessage,
  type NegotiationError,
  type NegotiationResult,
} from "@/lib/negotiation/repository";

/**
 * Actions de l'agent de négociation. Chacune repart de l'utilisateur courant :
 * le contact d'une autre personne est traité comme inexistant (404). Rien
 * n'est envoyé sans l'action explicite « Envoyer » sur un message approuvé,
 * et aucune décision n'est prise à la place du candidat.
 */

export type NegotiationActionState = {
  ok?: "saved" | "approved" | "sent" | "generated";
  error?: NegotiationError | "invalid";
  fields?: MandateField[];
  issues?: NegotiationIssue[];
  excerpt?: string;
  limit?: number;
  /** Brouillon préparé par le modèle déterministe faute d'IA (code). */
  fallback?: string;
};

async function guard<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }
}

const refresh = () => revalidatePath("/[locale]/app", "layout");

function failure(result: Extract<NegotiationResult, { ok: false }>): NegotiationActionState {
  return {
    error: result.error,
    issues: result.issues,
    excerpt: result.identity?.find((i) => i.excerpt)?.excerpt,
    limit: result.error === "quota" ? contactDailyLimit() : undefined,
  };
}

export async function saveMandateAction(
  contactId: string,
  _prev: NegotiationActionState,
  formData: FormData,
): Promise<NegotiationActionState> {
  const user = await requireUser();
  const result = await guard(() =>
    saveMandate(
      user.id,
      contactId,
      mandateFromForm((name) => formData.get(name)),
    ),
  );
  refresh();
  if (result.ok) return { ok: "saved" };
  if (result.error === "invalid") return { error: "invalid", fields: result.fields };
  return failure(result);
}

export async function generateDraftAction(
  contactId: string,
  kind: "counter" | "closing",
): Promise<NegotiationActionState> {
  const user = await requireUser();
  const deps = contactDeps();
  const entitlements = await getEntitlements(user.id);
  const result = await guard(() =>
    generateDraft(user.id, contactId, kind, { ai: deps.ai, entitlements }),
  );
  refresh();
  if (!result.ok) return failure(result);
  return { ok: "generated", fallback: result.fallback };
}

export async function updateMessageAction(
  contactId: string,
  messageId: string,
  _prev: NegotiationActionState,
  formData: FormData,
): Promise<NegotiationActionState> {
  const user = await requireUser();
  const result = await guard(() =>
    updateMessage(user.id, contactId, messageId, { body: formData.get("body") }),
  );
  refresh();
  if (result.ok) return { ok: "saved" };
  return result.error === "invalid" ? { error: "invalid" } : failure(result);
}

export async function approveMessageAction(
  contactId: string,
  messageId: string,
): Promise<NegotiationActionState> {
  const user = await requireUser();
  const result = await guard(() =>
    approveMessage(user.id, contactId, messageId, { appUrl: contactDeps().appUrl }),
  );
  refresh();
  return result.ok ? { ok: "approved" } : failure(result);
}

export async function sendMessageAction(
  contactId: string,
  messageId: string,
): Promise<NegotiationActionState> {
  const user = await requireUser();
  const deps = contactDeps();
  const result = await guard(() =>
    sendMessage(user.id, contactId, messageId, { send: deps.send, appUrl: deps.appUrl }),
  );
  refresh();
  return result.ok ? { ok: "sent" } : failure(result);
}

export async function markTransmittedAction(contactId: string, messageId: string) {
  const user = await requireUser();
  await guard(() => markTransmitted(user.id, contactId, messageId));
  refresh();
}

export async function discardMessageAction(contactId: string, messageId: string) {
  const user = await requireUser();
  await guard(() => discardMessage(user.id, contactId, messageId));
  refresh();
}

export async function setOutcomeAction(contactId: string, outcome: string) {
  const user = await requireUser();
  await guard(() => setOutcome(user.id, contactId, outcome));
  refresh();
}
