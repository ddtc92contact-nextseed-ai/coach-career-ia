"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { db } from "@/lib/db";
import { unsubscribeAlerts } from "@/lib/matching/alerts";

/** Désabonnement depuis le lien d'un e-mail (sans connexion : le jeton fait foi). */
export async function confirmUnsubscribe(token: string) {
  const ok = await unsubscribeAlerts(db, token);
  return redirect({
    href: `/alertes/desabonnement?${ok ? "termine=1" : "invalide=1"}`,
    locale: await getLocale(),
  });
}
