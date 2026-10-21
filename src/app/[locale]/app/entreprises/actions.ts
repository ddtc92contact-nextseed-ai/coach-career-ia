"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { looksLikeUrl } from "@/lib/radar/careers";
import { followHttpClient, followProbeLimiter } from "@/lib/radar/follow-client";
import {
  followByUrl,
  followCompany,
  searchCompanies,
  unfollowCompany,
  type CompanySearchResult,
  type FollowError,
} from "@/lib/radar/followed";

export type FollowFormState = {
  error?: FollowError | "tooShort" | "unavailable";
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
  const companyId = formData.get("companyId");
  if (typeof companyId === "string" && companyId) {
    const result = await followCompany(db, user.id, companyId);
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

  const input = String(formData.get("company") ?? "").trim();
  if (input.length < 2) return { error: "tooShort" };

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
  await unfollowCompany(db, user.id, companyId);
  revalidate();
}
