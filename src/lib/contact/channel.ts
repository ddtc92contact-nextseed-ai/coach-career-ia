import type { ContactChannel } from "@/generated/prisma/enums";
import { DIRECT_SOURCE } from "@/lib/employer/config";

/**
 * Canal d'une prise de contact, d'après l'offre (module pur, testable) :
 * - offre publiée directement sur la plateforme (`source = "direct"`, avec
 *   son organisation) : messagerie de l'espace entreprise (`PORTAL`), jamais
 *   d'e-mail contenant le message ;
 * - sinon l'e-mail de candidature publié en priorité, puis la page « Postuler ».
 */
export function channelFor(offer: {
  source?: string | null;
  orgId?: string | null;
  applyEmail: string | null;
  applyUrl: string | null;
}): ContactChannel | null {
  if (offer.source === DIRECT_SOURCE) return offer.orgId ? "PORTAL" : null;
  if (offer.applyEmail) return "EMAIL";
  if (offer.applyUrl) return "APPLY_URL";
  return null;
}

/** Canaux envoyés par l'application : ils comptent dans le quota quotidien. */
export const QUOTA_CHANNELS = ["EMAIL", "PORTAL"] as const satisfies readonly ContactChannel[];
