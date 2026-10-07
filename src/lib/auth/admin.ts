import "server-only";
import { notFound } from "next/navigation";
import { requireUser, type CurrentUser } from "@/lib/auth/session";
import { isAdminEmail } from "@/lib/auth/admin-emails";

export { isAdminEmail };

/**
 * Pages d'administration : réservées aux adresses de `ADMIN_EMAILS`.
 * Pour les autres utilisateurs, la page n'existe pas (404).
 */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireUser();
  if (!isAdminEmail(user.email)) notFound();
  return user;
}
