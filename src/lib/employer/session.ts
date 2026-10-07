import "server-only";
import { cache } from "react";
import { notFound } from "next/navigation";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { getMembership, type Organization } from "./repository";

export type Employer = { user: CurrentUser; org: Organization; role: "OWNER" | "MEMBER" };

/**
 * Membre d'une organisation, ou 404 : un compte uniquement candidat n'a
 * accès à aucune page de l'espace entreprise (hors inscription). À appeler
 * au début de chaque page et action de `/entreprise`. Mémoïsé pour la requête.
 */
export const requireEmployer = cache(async (): Promise<Employer> => {
  const user = await requireUser();
  const membership = await getMembership(user.id);
  if (!membership) notFound();
  return { user, org: membership.organization, role: membership.role };
});
