"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth/session";
import { ALERT_FREQUENCIES, ALERT_MIN_SCORES } from "@/lib/matching/alerts";
import { saveAlertSettings } from "@/lib/matching/repository";

const alertSettingsInput = z.object({
  frequency: z.enum(ALERT_FREQUENCIES),
  minScore: z.coerce
    .number()
    .int()
    .refine((v) => (ALERT_MIN_SCORES as readonly number[]).includes(v)),
});

export async function updateAlertSettings(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = alertSettingsInput.safeParse({
    frequency: formData.get("frequency"),
    minScore: formData.get("minScore"),
  });
  if (!parsed.success) return { errors: { _form: "invalidChoice" } };
  await saveAlertSettings(user.id, parsed.data);
  revalidatePath("/[locale]/app/parametres", "page");
  return { ok: true };
}
