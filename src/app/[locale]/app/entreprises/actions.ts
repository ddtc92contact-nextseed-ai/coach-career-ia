"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { looksLikeUrl } from "@/lib/radar/careers";
import { followHttpClient, followProbeLimiter } from "@/lib/radar/follow-client";
import { companyIdInput, followQueryInput } from "@/lib/radar/follow-schemas";
import {
  followByUrl,
  followCompany,
  searchCompanies,
  unfollowCompany,
  type CompanySearchResult,
  type FollowError,
} from "@/lib/radar/followed";

export type FollowFormState = {
  error?: FollowError | "tooShort" | "tooLong" | "invalidInput" | "unavailable";
  added?: { name: string; openOffers: number; alreadyFollowed: boolean };
  /** Recherche par nom : entreprises déjà surveillées par le radar. */
  search?: { query: string; results: CompanySearchResult[] };
};

const revalidate = () => revalidatePath("/[locale]/app", "layout");

/**
 * URL de page carrières (détection de l'ATS, validation), recherche par nom,
 * ou suivi d'une entreprise trouvée par la recherche (`companyId`).
 */
export async function addFollowedCompany(
  _prev: FollowFormState,
  formData: FormData,
): Promise<FollowFormState> {
  const user = await requireUser();
  // Bouton « Suivre » d'un résultat de recherche.
  const rawId = formData.get("companyId");
  if (rawId !== null) {
    const companyId = companyIdInput.safeParse(rawId);
    if (!companyId.success) return { error: "invalidInput" };
    const result = await followCompany(db, user.id, companyId.data);
    if (!result.ok) return { error: result.error };
    revalidate();
    return {
      added: {
        name: result.name,
        openOffers: result.openOffers,
        alreadyFollowed: result.alreadyFollowed,
      },
    };
  }

  const parsed = followQueryInput.safeParse(formData.get("company") ?? "");
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    return { error: code === "tooShort" || code === "tooLong" ? code : "invalidInput" };
  }
  const input = parsed.data;

  if (!looksLikeUrl(input)) {
    return { search: { query: input, results: await searchCompanies(db, user.id, input) } };
  }
  const http = followHttpClient();
  if (!http) return { error: "unavailable" };
  const result = await followByUrl(db, user.id, input, {
    http,
    allowProbe: () => followProbeLimiter.take(user.id),
  });
  // Compteur seul : ni l'utilisateur ni l'entreprise (donnée personnelle).
  logger.info("radar.follow.attempt", { outcome: result.ok ? "ok" : result.error });
  if (!result.ok) return { error: result.error };
  revalidate();
  return {
    added: {
      name: result.name,
      openOffers: result.openOffers,
      alreadyFollowed: result.alreadyFollowed,
    },
  };
}

export async function unfollow(companyId: string) {
  const user = await requireUser();
  const parsed = companyIdInput.safeParse(companyId);
  if (!parsed.success) return;
  await unfollowCompany(db, user.id, parsed.data);
  revalidate();
}
