import "server-only";
import { LEGAL_TERMS_VERSION } from "@/config/legal";
import { db } from "@/lib/db";

/**
 * Enregistre sur le compte la version des conditions d'utilisation et de la
 * politique de confidentialité acceptées, et sa date. Appelée à chaque
 * connexion : le formulaire du lien magique (seule porte d'entrée) affiche
 * « en continuant, vous acceptez… ». Ne réécrit rien si la version courante
 * est déjà enregistrée (la date reste celle de la première acceptation).
 */
export async function recordTermsAcceptance(userId: string, now: Date = new Date()) {
  const { count } = await db.user.updateMany({
    where: {
      id: userId,
      OR: [{ termsVersion: null }, { termsVersion: { not: LEGAL_TERMS_VERSION } }],
    },
    data: { termsVersion: LEGAL_TERMS_VERSION, termsAcceptedAt: now },
  });
  return count > 0;
}
