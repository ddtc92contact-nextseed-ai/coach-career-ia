import "server-only";
import { cache } from "react";
import { headers } from "next/headers";
import { getLocale } from "next-intl/server";
import { auth } from "@/auth";
import { redirect } from "@/i18n/navigation";
import { loginPath, PATHNAME_HEADER } from "@/lib/auth/redirect";

export type CurrentUser = {
  id: string;
  email: string;
};

/** Utilisateur connecté, ou `null`. Mémoïsé pour la durée d'une requête. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !user.email) return null;
  return { id: user.id, email: user.email };
});

/**
 * Renvoie l'utilisateur courant ou redirige vers la page de connexion (dans
 * la langue courante), en conservant la page demandée (session expirée ou
 * cookie invalide).
 *
 * À appeler au début de chaque page, action serveur et route protégée. Toute
 * requête sur une donnée métier doit ensuite être filtrée par `user.id`.
 */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) {
    const [requestHeaders, locale] = await Promise.all([headers(), getLocale()]);
    return redirect({ href: loginPath(requestHeaders.get(PATHNAME_HEADER)), locale });
  }
  return user;
}
