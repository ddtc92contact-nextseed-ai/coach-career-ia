"use server";

import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { billingMode } from "@/lib/billing/config";
import {
  applySimulatorAction,
  cancelSimulatedCheckout,
  getSimulatedCheckout,
} from "@/lib/billing/simulator-server";

/**
 * Actions du simulateur de paiement (phase de test). Elles n'agissent que sur
 * les abonnements simulés de l'utilisateur connecté : une session d'un autre
 * compte est introuvable (404). Hors simulateur, elles n'existent pas.
 */

async function requireSimulatorUser() {
  if (billingMode() !== "simulator") notFound();
  return requireUser();
}

const checkoutInput = z.object({
  session: z.string().min(1).max(100),
  outcome: z.enum(["success", "declined", "cancel"]),
});

/** Boutons de la page de paiement simulée. */
export async function completeSimulatedCheckout(formData: FormData) {
  const user = await requireSimulatorUser();
  const parsed = checkoutInput.safeParse({
    session: formData.get("session"),
    outcome: formData.get("outcome"),
  });
  if (!parsed.success) notFound();
  const { session, outcome } = parsed.data;
  const locale = await getLocale();

  if (outcome === "cancel") {
    if (!(await cancelSimulatedCheckout(user.id, session))) notFound();
    return redirect({ href: "/app/billing?checkout=cancel", locale });
  }
  if (outcome === "declined") {
    // Comme chez Stripe : carte refusée, on reste sur la page de paiement, rien n'est émis.
    if (!(await getSimulatedCheckout(user.id, session))) notFound();
    return redirect({ href: `/app/billing/simulation/paiement/${session}?refus=1`, locale });
  }
  const result = await applySimulatorAction(user.id, "pay", { checkoutSessionId: session });
  if (result === "notFound") notFound();
  return redirect({
    href: result === "ok" ? "/app/billing?checkout=success" : "/app/billing?error=checkout",
    locale,
  });
}

const portalInput = z.enum(["cancelAtPeriodEnd", "resume", "cancelNow", "payOutstanding"]);

/** Boutons de l'espace de gestion simulé. */
export async function simulatedPortalAction(formData: FormData) {
  const user = await requireSimulatorUser();
  const parsed = portalInput.safeParse(formData.get("action"));
  if (!parsed.success) notFound();
  const result = await applySimulatorAction(user.id, parsed.data);
  const locale = await getLocale();
  return redirect({
    href: `/app/billing/simulation/portail?${result === "ok" ? "fait" : "erreur"}=${parsed.data}`,
    locale,
  });
}
