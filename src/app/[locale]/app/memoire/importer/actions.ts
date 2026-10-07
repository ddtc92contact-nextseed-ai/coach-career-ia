"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { importDraft, type ImportedDraftSummary } from "@/lib/career/repository";
import { CareerMemoryDraft, toFieldErrors, type FieldErrors } from "@/lib/career/schemas";
import { logger } from "@/lib/logger";

export type SaveImportResult =
  { ok: true; summary: ImportedDraftSummary } | { ok: false; errors: FieldErrors };

/**
 * Enregistre les seuls éléments ACCEPTÉS par le candidat pendant la revue.
 * Le brouillon est revalidé ici : rien ne vient du modèle sans contrôle.
 */
export async function saveImport(input: unknown): Promise<SaveImportResult> {
  const user = await requireUser();
  const parsed = CareerMemoryDraft.safeParse(input);
  if (!parsed.success) return { ok: false, errors: toFieldErrors(parsed.error) };
  const draft = parsed.data;
  if (!draft.experiences.length && !draft.achievements.length && !draft.skills.length) {
    return { ok: false, errors: { _form: "required" } };
  }
  const summary = await importDraft(user.id, draft);
  logger.info("import.saved", {
    userId: user.id,
    experiences: summary.experiences,
    achievements: summary.achievements,
    skills: summary.skills,
  });
  revalidatePath("/[locale]/app", "layout");
  return { ok: true, summary };
}
