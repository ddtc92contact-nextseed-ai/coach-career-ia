"use server";

import { getLocale } from "next-intl/server";
import type { FormState } from "@/components/form";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { toFieldErrors } from "@/lib/career/schemas";
import { createOrganization } from "@/lib/employer/repository";
import { organizationInput } from "@/lib/employer/schema";

/** Inscription « Je recrute » : création de l'organisation du compte connecté. */
export async function createOrganizationAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = organizationInput.safeParse({
    name: formData.get("name") ?? undefined,
    website: formData.get("website") ?? undefined,
    sector: formData.get("sector") ?? undefined,
    size: formData.get("size") ?? undefined,
    country: formData.get("country") ?? undefined,
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  // Déjà membre d'une organisation : direction l'espace entreprise.
  await createOrganization(user, parsed.data);
  return redirect({ href: "/entreprise", locale: await getLocale() });
}
