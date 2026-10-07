"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/career/repository";
import { setMatchStatus } from "@/lib/matching/repository";

const changeInput = z.object({
  id: z.string().min(1).max(64),
  status: z.enum(["SEEN", "SAVED", "DISMISSED"]),
});

/**
 * Sauvegarder, écarter ou remettre une opportunité dans la liste. Filtré par
 * l'utilisateur courant : l'identifiant d'une autre personne est ignoré, et
 * une entrée mal formée (identifiant non textuel, statut inconnu) aussi.
 */
export async function changeMatchStatus(id: string, status: z.infer<typeof changeInput>["status"]) {
  const user = await requireUser();
  const parsed = changeInput.safeParse({ id, status });
  if (!parsed.success) return;
  try {
    await setMatchStatus(user.id, parsed.data.id, parsed.data.status);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  revalidatePath("/[locale]/app/opportunites", "layout");
}
