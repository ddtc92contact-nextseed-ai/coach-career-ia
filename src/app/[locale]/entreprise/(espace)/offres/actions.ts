"use server";

import { revalidatePath } from "next/cache";
import { notFound, redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import type { FormState } from "@/components/form";
import { redirect } from "@/i18n/navigation";
import { toFieldErrors } from "@/lib/career/schemas";
import {
  closePosting,
  createPosting,
  deleteDraft,
  publishFreeAsAdmin,
  renewPosting,
  startPostingCheckout,
  submitPosting,
  updatePosting,
  type PostingActionResult,
} from "@/lib/employer/repository";
import { formValues, POSTING_FIELDS, postingInput } from "@/lib/employer/schema";
import { requireEmployer } from "@/lib/employer/session";

/**
 * Actions de l'espace entreprise sur les offres. Chacune commence par
 * `requireEmployer()` et n'agit que sur les offres de l'organisation du
 * compte : l'offre d'une autre organisation est introuvable (404).
 */

const postingPath = (id: string) => `/entreprise/offres/${id}`;

async function back(id: string, query: string): Promise<never> {
  return redirect({ href: `${postingPath(id)}?${query}`, locale: await getLocale() });
}

async function finish(id: string, result: PostingActionResult, done: string): Promise<never> {
  if (!result.ok && result.error === "notFound") notFound();
  revalidatePath("/[locale]/entreprise", "layout");
  return back(id, result.ok ? `fait=${done}` : `erreur=${result.error}`);
}

export async function createPostingAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org } = await requireEmployer();
  const parsed = postingInput.safeParse(formValues(formData, POSTING_FIELDS));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const id = await createPosting(org, parsed.data);
  revalidatePath("/[locale]/entreprise", "layout");
  return redirect({ href: postingPath(id), locale: await getLocale() });
}

export async function updatePostingAction(
  postingId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const { org } = await requireEmployer();
  const parsed = postingInput.safeParse(formValues(formData, POSTING_FIELDS));
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  const result = await updatePosting(org, postingId, parsed.data);
  if (!result.ok && result.error === "notFound") notFound();
  if (!result.ok) return { errors: { _form: "invalid" } };
  revalidatePath("/[locale]/entreprise", "layout");
  return { ok: true };
}

export async function submitPostingAction(postingId: string) {
  const { org } = await requireEmployer();
  return finish(postingId, await submitPosting(org.id, postingId), "submitted");
}

export async function closePostingAction(postingId: string) {
  const { org } = await requireEmployer();
  return finish(postingId, await closePosting(org.id, postingId), "closed");
}

export async function renewPostingAction(postingId: string) {
  const { org } = await requireEmployer();
  return finish(postingId, await renewPosting(org.id, postingId), "renewed");
}

export async function adminPublishAction(postingId: string) {
  const { user, org } = await requireEmployer();
  return finish(postingId, await publishFreeAsAdmin(user, org.id, postingId), "published");
}

export async function deleteDraftAction(postingId: string) {
  const { org } = await requireEmployer();
  if (!(await deleteDraft(org.id, postingId))) return back(postingId, "erreur=notAllowed");
  revalidatePath("/[locale]/entreprise", "layout");
  return redirect({ href: "/entreprise", locale: await getLocale() });
}

/** Paiement de la publication (ou de sa prolongation) chez le fournisseur actif. */
export async function payPostingAction(postingId: string) {
  const { user, org } = await requireEmployer();
  const locale = await getLocale();
  const result = await startPostingCheckout(user, org, postingId, locale);
  if (!result.ok) {
    if (result.error === "notFound") notFound();
    return back(postingId, `erreur=${result.error}`);
  }
  if (result.redirect.kind === "internal") return redirect({ href: result.redirect.href, locale });
  return redirectExternal(result.redirect.url);
}
