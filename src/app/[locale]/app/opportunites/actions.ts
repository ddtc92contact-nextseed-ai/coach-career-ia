"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/career/repository";
import { setMatchStatus } from "@/lib/matching/repository";

const ALLOWED = ["SEEN", "SAVED", "DISMISSED"] as const;
type Status = (typeof ALLOWED)[number];

/**
 * Sauvegarder, écarter ou remettre une opportunité dans la liste. Filtré par
 * l'utilisateur courant : l'identifiant d'une autre personne est ignoré.
 */
export async function changeMatchStatus(id: string, status: Status) {
  const user = await requireUser();
  if (!ALLOWED.includes(status)) return;
  try {
    await setMatchStatus(user.id, id, status);
  } catch (error) {
    if (!(error instanceof NotFoundError)) throw error;
  }
  revalidatePath("/[locale]/app/opportunites", "layout");
}
