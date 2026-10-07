"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import type { FormState } from "@/components/form";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import {
  addDeclaredSkill,
  addDocumentProof,
  addTextProof,
  createAchievement,
  createExperience,
  deleteAchievement,
  deleteExperience,
  deleteProof,
  deleteSkill,
  NotFoundError,
  updateAchievement,
  updateExperience,
} from "@/lib/career/repository";
import {
  achievementInput,
  experienceInput,
  skillInput,
  textProofInput,
  toFieldErrors,
} from "@/lib/career/schemas";

/**
 * Actions de la mémoire de carrière : authentification (`requireUser`),
 * validation zod (erreurs = codes traduits côté client), puis accès aux
 * données TOUJOURS filtré par l'utilisateur courant (`repository.ts`).
 */

const MEMORY_PATH = "/[locale]/app";

function text(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

async function backToMemory(anchor = ""): Promise<never> {
  revalidatePath(MEMORY_PATH, "layout");
  return redirect({ href: `/app/memoire${anchor}`, locale: await getLocale() });
}

function notFound(): FormState {
  return { errors: { _form: "notFound" } };
}

// --- Expériences ------------------------------------------------------------------

export async function saveExperience(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = experienceInput.safeParse({
    roleTitle: text(formData, "roleTitle"),
    startMonth: text(formData, "startMonth"),
    endMonth: formData.get("current") ? "" : text(formData, "endMonth"),
    seniority: text(formData, "seniority"),
    contractType: text(formData, "contractType"),
    sector: text(formData, "sector"),
    companySize: text(formData, "companySize"),
    companyStage: text(formData, "companyStage"),
    responsibilities: text(formData, "responsibilities"),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  try {
    if (id) await updateExperience(user.id, id, parsed.data);
    else await createExperience(user.id, parsed.data);
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  return backToMemory("#experiences");
}

export async function removeExperience(id: string) {
  const user = await requireUser();
  try {
    await deleteExperience(user.id, id);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return backToMemory("#experiences");
}

// --- Réalisations -------------------------------------------------------------------

export async function saveAchievement(
  id: string | null,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const parsed = achievementInput.safeParse({
    title: text(formData, "title"),
    context: text(formData, "context"),
    actions: text(formData, "actions"),
    result: text(formData, "result"),
    skills: text(formData, "skills"),
    experienceId: text(formData, "experienceId"),
  });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  let targetId = id;
  try {
    if (id) await updateAchievement(user.id, id, parsed.data);
    else targetId = (await createAchievement(user.id, parsed.data)).id;
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  revalidatePath(MEMORY_PATH, "layout");
  // Après création, on enchaîne sur l'ajout de preuves.
  return redirect({
    href: id ? "/app/memoire#realisations" : `/app/memoire/realisations/${targetId}#preuves`,
    locale: await getLocale(),
  });
}

export async function removeAchievement(id: string) {
  const user = await requireUser();
  try {
    await deleteAchievement(user.id, id);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  return backToMemory("#realisations");
}

// --- Preuves --------------------------------------------------------------------------

export async function addProof(
  achievementId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireUser();
  const kind = text(formData, "kind");
  try {
    if (kind === "DOCUMENT") {
      const file = formData.get("file");
      if (!(file instanceof File) || file.size === 0) return { errors: { file: "fileRequired" } };
      const result = await addDocumentProof(user.id, achievementId, {
        name: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
      });
      if (!result.ok) return { errors: { file: result.error } };
    } else {
      const parsed = textProofInput.safeParse({
        kind,
        url: text(formData, "url").trim(),
        referenceText: text(formData, "referenceText"),
      });
      if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
      await addTextProof(user.id, achievementId, parsed.data);
    }
  } catch (error) {
    if (error instanceof NotFoundError) return notFound();
    throw error;
  }
  revalidatePath(MEMORY_PATH, "layout");
  return { ok: true };
}

export async function removeProof(proofId: string) {
  const user = await requireUser();
  try {
    await deleteProof(user.id, proofId);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  revalidatePath(MEMORY_PATH, "layout");
}

// --- Compétences ---------------------------------------------------------------------

export async function addSkill(_prev: FormState, formData: FormData): Promise<FormState> {
  const user = await requireUser();
  const parsed = skillInput.safeParse({ name: text(formData, "name") });
  if (!parsed.success) return { errors: toFieldErrors(parsed.error) };
  await addDeclaredSkill(user.id, parsed.data.name);
  revalidatePath(MEMORY_PATH, "layout");
  return { ok: true };
}

export async function removeSkill(id: string) {
  const user = await requireUser();
  try {
    await deleteSkill(user.id, id);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  revalidatePath(MEMORY_PATH, "layout");
}
