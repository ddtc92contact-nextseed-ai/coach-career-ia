"use server";

import { revalidatePath } from "next/cache";
import type { FormState } from "@/components/form";
import { requireUser } from "@/lib/auth/session";
import { saveGuardRails } from "@/lib/career/repository";
import { guardRailsInput, toFieldErrors } from "@/lib/career/schemas";

/** `unlocated` : index des lieux enregistrés sans coordonnées (géocodage impossible). */
export type GuardRailsFormState = FormState & { unlocated?: number[] };

export async function updateGuardRails(
  _prev: GuardRailsFormState,
  formData: FormData,
): Promise<GuardRailsFormState> {
  const user = await requireUser();
  const strings = (name: string) => formData.getAll(name).map(String);
  const radii = strings("locationRadius");

  const parsed = guardRailsInput.safeParse({
    minFixedSalary: String(formData.get("minFixedSalary") ?? ""),
    targetTotalPackage: String(formData.get("targetTotalPackage") ?? ""),
    remotePolicy: String(formData.get("remotePolicy") ?? ""),
    minRemoteDays: String(formData.get("minRemoteDays") ?? ""),
    contractTypes: strings("contractTypes"),
    excludedSectors: strings("excludedSectors"),
    excludedCompanies: String(formData.get("excludedCompanies") ?? "")
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
    maxWeeklyHours: String(formData.get("maxWeeklyHours") ?? ""),
    acceptsOnCall: formData.get("acceptsOnCall") === "on",
    culturePreferences: strings("culturePreferences"),
    locations: strings("locationLabel").map((label, index) => ({
      label,
      radiusKm: radii[index] ?? "",
    })),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };

  const { unlocated } = await saveGuardRails(user.id, parsed.data);
  revalidatePath("/[locale]/app", "layout");
  return { ok: true, unlocated };
}
