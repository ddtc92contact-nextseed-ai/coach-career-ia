import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { applyJobPostingPayment } from "@/lib/employer/publication";
import { logger } from "@/lib/logger";
import { SIMULATOR_ID_PREFIX } from "./config";
import type { BillingStore } from "./webhook";

/** Abonnement de l'utilisateur courant (page « Abonnement »). */
export function getBillingAccount(userId: string) {
  return db.user.findUnique({
    where: { id: userId },
    select: {
      plan: true,
      subscriptionStatus: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
      stripeCustomerId: true,
    },
  });
}

/**
 * Rattache le client Stripe créé pour l'utilisateur. Sans effet si un client
 * est déjà enregistré : renvoie celui qui fait foi. Un client du simulateur
 * (`sim_…`, phase de test) est remplacé par le vrai.
 */
export async function saveStripeCustomerId(userId: string, customerId: string) {
  await db.user.updateMany({
    where: {
      id: userId,
      OR: [{ stripeCustomerId: null }, { stripeCustomerId: { startsWith: SIMULATOR_ID_PREFIX } }],
    },
    data: { stripeCustomerId: customerId },
  });
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });
  return user?.stripeCustomerId ?? null;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";

/** Stockage du webhook : journal des évènements traités + état d'abonnement. */
export const prismaBillingStore: BillingStore = {
  async isProcessed(eventId) {
    return (await db.stripeEvent.count({ where: { id: eventId } })) > 0;
  },

  async apply(event, sync) {
    try {
      return await db.$transaction(async (tx) => {
        // Clé primaire : une seconde livraison simultanée échoue ici (P2002).
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
        if (!sync) return "applied";

        // Compte désigné par nos métadonnées, sinon par le client Stripe.
        const byMetadata = sync.userId
          ? await tx.user.findUnique({
              where: { id: sync.userId },
              select: { id: true, plan: true, stripeCustomerId: true, stripeSubscriptionId: true },
            })
          : null;
        const user =
          byMetadata &&
          (!byMetadata.stripeCustomerId || byMetadata.stripeCustomerId === sync.customerId)
            ? byMetadata
            : await tx.user.findUnique({
                where: { stripeCustomerId: sync.customerId },
                select: {
                  id: true,
                  plan: true,
                  stripeCustomerId: true,
                  stripeSubscriptionId: true,
                },
              });
        if (!user) return "unmatched";

        // La fin d'un ancien abonnement n'écrase pas un abonnement plus récent encore actif.
        const stale =
          user.stripeSubscriptionId !== null &&
          user.stripeSubscriptionId !== sync.subscriptionId &&
          user.plan === "PREMIUM" &&
          sync.plan === "FREE";
        if (stale) return "applied";

        await tx.user.update({
          where: { id: user.id },
          data: {
            plan: sync.plan,
            subscriptionStatus: sync.status,
            currentPeriodEnd: sync.currentPeriodEnd,
            cancelAtPeriodEnd: sync.cancelAtPeriodEnd,
            stripeCustomerId: sync.customerId,
            stripeSubscriptionId: sync.subscriptionId,
          },
        });
        return "applied";
      });
    } catch (error) {
      // Évènement enregistré entre-temps par une livraison concurrente.
      if (isUniqueViolation(error) && (await prismaBillingStore.isProcessed(event.id))) {
        return "duplicate";
      }
      throw error;
    }
  },

  async applyPayment(event, payment) {
    try {
      return await db.$transaction(async (tx) => {
        await tx.stripeEvent.create({ data: { id: event.id, type: event.type } });
        switch (payment.kind) {
          case "job_posting":
            return applyJobPostingPayment(tx, payment, { logger });
        }
      });
    } catch (error) {
      if (isUniqueViolation(error) && (await prismaBillingStore.isProcessed(event.id))) {
        return "duplicate";
      }
      throw error;
    }
  },
};
