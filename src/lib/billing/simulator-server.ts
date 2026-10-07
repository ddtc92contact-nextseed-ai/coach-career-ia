import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { isSimulatedId } from "./config";
import { prismaBillingStore } from "./repository";
import {
  deliverSimulatorEvents,
  isDue,
  LIVE_STATUSES,
  simId,
  simulatorEvent,
  simulatorPaymentEvent,
  transition,
  type SimAction,
  type SimSubscription,
} from "./simulator";

/**
 * État du simulateur en base (`simulated_subscriptions`). Toutes les
 * fonctions prennent l'utilisateur concerné : un candidat n'agit que sur ses
 * propres abonnements simulés (une session de paiement d'un autre compte est
 * introuvable).
 */

const select = {
  id: true,
  userId: true,
  customerId: true,
  checkoutSessionId: true,
  status: true,
  cancelAtPeriodEnd: true,
  currentPeriodEnd: true,
  updatedAt: true,
} as const;

/** Lecture par identifiant : utilisée par le « Stripe » simulé (`subscriptions.retrieve`). */
async function lookup(subscriptionId: string): Promise<SimSubscription | null> {
  return db.simulatedSubscription.findUnique({ where: { id: subscriptionId }, select });
}

/** Abonnement simulé en cours du compte (actif, en essai ou en relance), s'il existe. */
export function getCurrentSimulatedSubscription(userId: string) {
  return db.simulatedSubscription.findFirst({
    where: { userId, status: { in: LIVE_STATUSES } },
    orderBy: { createdAt: "desc" },
    select,
  });
}

/** Session de paiement simulée en attente, appartenant au compte. */
export function getSimulatedCheckout(userId: string, checkoutSessionId: string) {
  return db.simulatedSubscription.findFirst({
    where: { userId, checkoutSessionId, status: "INCOMPLETE" },
    select,
  });
}

/**
 * Ouvre une session de paiement simulée. `null` si le compte a déjà un
 * abonnement en cours, ou s'il est rattaché à un vrai client Stripe.
 */
export async function createSimulatedCheckout(userId: string): Promise<string | null> {
  const account = await db.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });
  if (!account) return null;
  if (account.stripeCustomerId && !isSimulatedId(account.stripeCustomerId)) return null;
  if (await getCurrentSimulatedSubscription(userId)) return null;

  // Une seule session en attente par compte.
  await db.simulatedSubscription.deleteMany({ where: { userId, status: "INCOMPLETE" } });
  const created = await db.simulatedSubscription.create({
    data: {
      id: simId("sub"),
      userId,
      customerId: account.stripeCustomerId ?? simId("cus"),
      checkoutSessionId: simId("cs"),
    },
    select: { checkoutSessionId: true },
  });
  return created.checkoutSessionId;
}

/** Abandon du paiement simulé (bouton « Annuler »). */
export async function cancelSimulatedCheckout(userId: string, checkoutSessionId: string) {
  const { count } = await db.simulatedSubscription.deleteMany({
    where: { userId, checkoutSessionId, status: "INCOMPLETE" },
  });
  return count > 0;
}

export type SimOutcome = "ok" | "notFound" | "notAllowed";

/**
 * Applique une action à l'abonnement simulé du compte (la session indiquée
 * pour `pay`, l'abonnement en cours sinon), puis livre les évènements au
 * traitement du webhook, qui met à jour l'offre.
 */
export async function applySimulatorAction(
  userId: string,
  action: SimAction,
  options: { checkoutSessionId?: string; now?: Date } = {},
): Promise<SimOutcome> {
  const now = options.now ?? new Date();
  const sub =
    action === "pay"
      ? options.checkoutSessionId
        ? await getSimulatedCheckout(userId, options.checkoutSessionId)
        : null
      : await getCurrentSimulatedSubscription(userId);
  if (!sub) return "notFound";
  return run(sub, action, now);
}

async function run(
  sub: SimSubscription & { updatedAt: Date },
  action: SimAction,
  now: Date,
): Promise<SimOutcome> {
  const step = transition(sub, action, now);
  if (!step) return "notAllowed";

  // Mise à jour conditionnelle : un double clic ne rejoue pas la transition.
  const { count } = await db.simulatedSubscription.updateMany({
    where: { id: sub.id, status: sub.status, updatedAt: sub.updatedAt },
    data: step.next,
  });
  if (count === 0) return "notAllowed";

  const updated: SimSubscription = { ...sub, ...step.next };
  await deliverSimulatorEvents({
    events: step.events.map((type) => simulatorEvent(type, updated, now)),
    lookup,
    store: prismaBillingStore,
    logger,
  });
  logger.info("billing.simulator.action", { userId: sub.userId, action, status: updated.status });
  return "ok";
}

/**
 * Ce que Stripe ferait de lui-même à l'échéance (renouvellement, fin d'un
 * abonnement résilié, fin des relances) : appliqué à la lecture des droits.
 */
export async function settleDueSimulatedSubscription(userId: string, now: Date = new Date()) {
  const sub = await getCurrentSimulatedSubscription(userId);
  if (!sub || !isDue(sub, now)) return;
  await run(sub, "periodEnd", now);
}

/**
 * Contrôles d'administration (phase de test) : forcer Premium ou l'offre
 * gratuite, toujours en passant par les évènements simulés.
 */
export async function forceSimulatedPlan(
  userId: string,
  plan: "PREMIUM" | "FREE",
): Promise<SimOutcome> {
  const current = await getCurrentSimulatedSubscription(userId);
  if (plan === "FREE") {
    return current ? run(current, "cancelNow", new Date()) : "ok";
  }
  if (current) {
    if (current.status === "PAST_DUE") return run(current, "payOutstanding", new Date());
    if (current.cancelAtPeriodEnd) return run(current, "resume", new Date());
    return "ok";
  }
  const session = await createSimulatedCheckout(userId);
  if (!session) return "notAllowed";
  return applySimulatorAction(userId, "pay", { checkoutSessionId: session });
}

/** Session de paiement unitaire simulée en attente, appartenant au compte. */
export function getSimulatedJobPostingCheckout(userId: string, checkoutSessionId: string) {
  return db.jobPostingPayment.findFirst({
    where: { userId, checkoutSessionId, provider: "simulator", status: "PENDING" },
    select: {
      id: true,
      postingId: true,
      amountCents: true,
      currency: true,
      posting: { select: { offer: { select: { title: true } } } },
    },
  });
}

/**
 * Paiement unitaire simulé accepté : le simulateur émet le
 * `checkout.session.completed` (`mode=payment`) que Stripe enverrait, traité
 * par le même code que le webhook. `notFound` si la session n'appartient pas
 * au compte ou n'est plus en attente.
 */
export async function paySimulatedJobPosting(
  userId: string,
  checkoutSessionId: string,
  now: Date = new Date(),
): Promise<SimOutcome> {
  const payment = await getSimulatedJobPostingCheckout(userId, checkoutSessionId);
  if (!payment) return "notFound";
  await deliverSimulatorEvents({
    events: [
      simulatorPaymentEvent(
        {
          checkoutSessionId,
          userId,
          kind: "job_posting",
          paymentId: payment.id,
          amountCents: payment.amountCents,
          currency: payment.currency,
        },
        now,
      ),
    ],
    lookup,
    store: prismaBillingStore,
    logger,
  });
  const after = await db.jobPostingPayment.findUnique({
    where: { id: payment.id },
    select: { status: true },
  });
  return after?.status === "PAID" ? "ok" : "notAllowed";
}

/** Abandon d'un paiement unitaire simulé (bouton « Annuler »). */
export async function cancelSimulatedJobPosting(userId: string, checkoutSessionId: string) {
  const { count } = await db.jobPostingPayment.updateMany({
    where: { userId, checkoutSessionId, provider: "simulator", status: "PENDING" },
    data: { status: "CANCELED" },
  });
  return count > 0;
}
