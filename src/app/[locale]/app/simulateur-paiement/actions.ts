"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { requireAdmin } from "@/lib/auth/admin";
import { billingMode } from "@/lib/billing/config";
import {
  applySimulatorAction,
  forceSimulatedPlan,
  type SimOutcome,
} from "@/lib/billing/simulator-server";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";

/**
 * Contrôles de test du simulateur de paiement, réservés aux administrateurs
 * (`requireAdmin` : 404 pour les autres). L'utilisateur visé est désigné par
 * son identifiant (jamais l'e-mail dans l'URL : elle finit dans les journaux
 * d'accès).
 */

const PAGE = "/app/simulateur-paiement";

async function back(query: string): Promise<never> {
  return redirect({ href: `${PAGE}?${query}`, locale: await getLocale() });
}

/** Recherche d'un compte par adresse e-mail. */
export async function findBillingUser(formData: FormData) {
  await requireAdmin();
  const email = z.email().safeParse(
    String(formData.get("email") ?? "")
      .trim()
      .toLowerCase(),
  );
  const user = email.success
    ? await db.user.findFirst({
        where: { email: { equals: email.data, mode: "insensitive" } },
        select: { id: true },
      })
    : null;
  return back(user ? `u=${user.id}` : "introuvable=1");
}

const ADMIN_SIM_ACTIONS = ["forcePremium", "forceFree", "periodEnd", "failRenewal"] as const;

const input = z.object({
  userId: z.string().min(1).max(100),
  action: z.enum(ADMIN_SIM_ACTIONS),
});

export async function adminSimulatorAction(formData: FormData) {
  const admin = await requireAdmin();
  const parsed = input.safeParse({
    userId: formData.get("userId"),
    action: formData.get("action"),
  });
  if (!parsed.success) return back("erreur=invalide");
  const { userId, action } = parsed.data;
  if (billingMode() !== "simulator") return back(`u=${userId}&erreur=inactif`);
  if (!(await db.user.count({ where: { id: userId } }))) return back("introuvable=1");

  let result: SimOutcome;
  switch (action) {
    case "forcePremium":
      result = await forceSimulatedPlan(userId, "PREMIUM");
      break;
    case "forceFree":
      result = await forceSimulatedPlan(userId, "FREE");
      break;
    default:
      result = await applySimulatorAction(userId, action);
  }
  logger.info("billing.simulator.admin", { adminId: admin.id, userId, action, result });
  return back(`u=${userId}&${result === "ok" ? "fait" : "erreur"}=${action}`);
}
