import "server-only";
import { getLocale } from "next-intl/server";
import { db } from "@/lib/db";
import { getCurrentUser } from "@/lib/auth/session";
import { DEFAULT_LOCALE, isAppLocale, type AppLocale } from "@/i18n/routing";

/**
 * Langue d'un utilisateur, pour tout texte produit hors de l'interface :
 * e-mails, textes générés par l'IA, exports…
 *
 * Ordre : préférence enregistrée du compte (`users.locale`), puis langue de
 * la requête en cours, puis français. Sans `userId`, l'utilisateur connecté.
 */
export async function getUserLocale(userId?: string): Promise<AppLocale> {
  const id = userId ?? (await getCurrentUser())?.id;
  if (id) {
    const user = await db.user.findUnique({ where: { id }, select: { locale: true } });
    if (isAppLocale(user?.locale)) return user.locale;
  }
  try {
    const requestLocale = await getLocale();
    if (isAppLocale(requestLocale)) return requestLocale;
  } catch {
    // Hors requête (tâche de fond) : pas de langue de requête.
  }
  return DEFAULT_LOCALE;
}
