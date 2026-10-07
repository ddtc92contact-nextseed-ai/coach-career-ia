"use server";

import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { billingMode } from "@/lib/billing/config";
import {
  cancelSimulatedJobPosting,
  getSimulatedJobPostingCheckout,
  paySimulatedJobPosting,
} from "@/lib/billing/simulator-server";
import { requireEmployer } from "@/lib/employer/session";

const input = z.object({
  session: z.string().min(1).max(100),
  outcome: z.enum(["success", "declined", "cancel"]),
});

/**
 * Boutons de la page de paiement simulée d'une publication (phase de test).
 * Seul le membre qui a ouvert le paiement peut le conclure (404 sinon).
 */
export async function completeSimulatedPostingCheckout(formData: FormData) {
  if (billingMode() !== "simulator") notFound();
  const { user } = await requireEmployer();
  const parsed = input.safeParse({
    session: formData.get("session"),
    outcome: formData.get("outcome"),
  });
  if (!parsed.success) notFound();
  const { session, outcome } = parsed.data;
  const checkout = await getSimulatedJobPostingCheckout(user.id, session);
  if (!checkout) notFound();
  const locale = await getLocale();
  const offerPath = `/entreprise/offres/${checkout.postingId}`;

  if (outcome === "cancel") {
    await cancelSimulatedJobPosting(user.id, session);
    return redirect({ href: `${offerPath}?paiement=annule`, locale });
  }
  if (outcome === "declined") {
    return redirect({ href: `/entreprise/paiement/${session}?refus=1`, locale });
  }
  const result = await paySimulatedJobPosting(user.id, session);
  return redirect({
    href: result === "ok" ? `${offerPath}?paiement=ok` : `${offerPath}?erreur=notAllowed`,
    locale,
  });
}
