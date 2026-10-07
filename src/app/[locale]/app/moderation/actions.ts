"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import {
  approveOrganization,
  approvePosting,
  rejectPosting,
  suspendOrganization,
} from "@/lib/employer/admin";
import { reviewReason } from "@/lib/employer/schema";

/**
 * Décisions de modération, réservées aux administrateurs (`requireAdmin` :
 * 404 pour les autres). Un refus ou une suspension exige un motif, envoyé
 * par e-mail à l'entreprise.
 */

const PAGE = "/app/moderation";
const id = z.string().min(1).max(64);

async function back(query: string): Promise<never> {
  revalidatePath("/[locale]/app/moderation", "page");
  return redirect({ href: `${PAGE}?${query}`, locale: await getLocale() });
}

export async function approveOrganizationAction(formData: FormData) {
  const admin = await requireAdmin();
  const orgId = id.safeParse(formData.get("orgId"));
  if (!orgId.success) return back("erreur=invalide");
  const result = await approveOrganization(admin.id, orgId.data);
  return back(result ? "fait=orgApproved" : "erreur=etat");
}

export async function suspendOrganizationAction(formData: FormData) {
  const admin = await requireAdmin();
  const orgId = id.safeParse(formData.get("orgId"));
  const reason = reviewReason.safeParse(formData.get("reason"));
  if (!orgId.success) return back("erreur=invalide");
  if (!reason.success) return back("erreur=motif");
  const result = await suspendOrganization(admin.id, orgId.data, reason.data);
  return back(result ? "fait=orgSuspended" : "erreur=etat");
}

export async function approvePostingAction(formData: FormData) {
  const admin = await requireAdmin();
  const postingId = id.safeParse(formData.get("postingId"));
  if (!postingId.success) return back("erreur=invalide");
  const result = await approvePosting(admin.id, postingId.data);
  return back(result ? "fait=postingApproved" : "erreur=etat");
}

export async function rejectPostingAction(formData: FormData) {
  const admin = await requireAdmin();
  const postingId = id.safeParse(formData.get("postingId"));
  const reason = reviewReason.safeParse(formData.get("reason"));
  if (!postingId.success) return back("erreur=invalide");
  if (!reason.success) return back("erreur=motif");
  const result = await rejectPosting(admin.id, postingId.data, reason.data);
  return back(result ? "fait=postingRejected" : "erreur=etat");
}
