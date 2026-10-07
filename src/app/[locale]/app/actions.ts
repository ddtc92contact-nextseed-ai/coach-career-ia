"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale } from "next-intl/server";
import { signOut } from "@/auth";
import type { FormState } from "@/components/form";
import { redirect } from "@/i18n/navigation";
import { isAppLocale } from "@/i18n/routing";
import { getCurrentUser, requireUser } from "@/lib/auth/session";
import { closeStripeCustomer } from "@/lib/billing/server";
import { deleteAccount, setUserLocale, setVisibility } from "@/lib/career/repository";
import { visibilityInput } from "@/lib/career/schemas";
import { logger } from "@/lib/logger";

export async function logout() {
  const locale = await getLocale();
  await signOut({ redirectTo: `/${locale}` });
}

/** Enregistre la langue choisie comme préférence du compte (si connecté). */
export async function saveLocalePreference(locale: string) {
  if (!isAppLocale(locale)) return;
  const user = await getCurrentUser();
  if (user) await setUserLocale(user.id, locale);
}

export async function updateVisibility(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = visibilityInput.safeParse(formData.get("visibility"));
  if (!parsed.success) return { errors: { visibility: "invalidChoice" } };
  await setVisibility(user.id, parsed.data);
  revalidatePath("/[locale]/app", "layout");
  return { ok: true };
}

/**
 * Suppression définitive du compte (RGPD). L'utilisateur confirme en
 * recopiant son adresse e-mail.
 */
export async function deleteMyAccount(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const confirmation = String(formData.get("confirmEmail") ?? "")
    .trim()
    .toLowerCase();
  if (confirmation !== user.email.toLowerCase()) {
    return { errors: { confirmEmail: "confirmMismatch" } };
  }
  const locale = await getLocale();
  // Abonnement résilié chez Stripe AVANT d'effacer le compte : jamais de prélèvement orphelin.
  if (!(await closeStripeCustomer(user.id))) {
    return { errors: { _form: "billingCancelFailed" } };
  }
  await deleteAccount(user.id);
  logger.info("account.deleted", { userId: user.id });
  // Les sessions ont été supprimées avec le compte (cascade) : il ne reste
  // qu'à effacer le cookie de session du navigateur.
  const jar = await cookies();
  for (const name of ["authjs.session-token", "__Secure-authjs.session-token"]) jar.delete(name);
  return redirect({ href: "/", locale });
}
