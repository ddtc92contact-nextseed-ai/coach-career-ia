import type Stripe from "stripe";
import type { Logger } from "@/lib/logger";
import type { PlanCode } from "./entitlements";

/**
 * Webhook Stripe : signature vérifiée, évènements traités une seule fois.
 *
 * L'offre est TOUJOURS dérivée de l'état de l'abonnement chez Stripe : quel
 * que soit l'évènement reçu, on relit l'abonnement concerné
 * (`subscriptions.retrieve`) plutôt que de se fier à son contenu, ce qui rend
 * le traitement insensible à l'ordre d'arrivée des évènements.
 *
 * Aucune dépendance à la base : le stockage est injecté (`BillingStore`).
 */

export const HANDLED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;

export const SUBSCRIPTION_STATUSES = [
  "INCOMPLETE",
  "INCOMPLETE_EXPIRED",
  "TRIALING",
  "ACTIVE",
  "PAST_DUE",
  "CANCELED",
  "UNPAID",
  "PAUSED",
] as const;
export type SubscriptionStatusCode = (typeof SUBSCRIPTION_STATUSES)[number];

/**
 * Statuts qui donnent accès à Premium. `PAST_DUE` : un paiement a échoué et
 * Stripe le retente ; l'accès est conservé pendant ces relances, puis Stripe
 * passe l'abonnement à `UNPAID` ou `CANCELED` (→ offre gratuite).
 */
const PREMIUM_STATUSES: ReadonlySet<SubscriptionStatusCode> = new Set([
  "ACTIVE",
  "TRIALING",
  "PAST_DUE",
]);

export function planForStatus(status: SubscriptionStatusCode): PlanCode {
  return PREMIUM_STATUSES.has(status) ? "PREMIUM" : "FREE";
}

/** État d'abonnement à enregistrer sur le compte. */
export type SubscriptionSync = {
  /** Compte indiqué dans les métadonnées (posées par notre Checkout). */
  userId: string | null;
  customerId: string;
  subscriptionId: string;
  status: SubscriptionStatusCode;
  plan: PlanCode;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
};

/**
 * Achat unitaire payé (Checkout `mode=payment`) : aujourd'hui, la publication
 * d'une offre par une entreprise (`metadata.kind = "job_posting"`).
 */
export const ONE_TIME_KINDS = ["job_posting"] as const;
export type OneTimeKind = (typeof ONE_TIME_KINDS)[number];

export type OneTimePayment = {
  kind: OneTimeKind;
  /** Notre identifiant d'achat (métadonnées posées à la création de la session). */
  paymentId: string;
  checkoutSessionId: string;
  /** Montant réellement payé, en centimes, et devise (majuscules). */
  amountCents: number | null;
  currency: string | null;
};

export type BillingStore = {
  isProcessed(eventId: string): Promise<boolean>;
  /**
   * Enregistre l'évènement et applique l'achat unitaire, atomiquement.
   * Facultatif : sans lui, l'évènement est seulement enregistré.
   */
  applyPayment?(
    event: { id: string; type: string },
    payment: OneTimePayment,
  ): Promise<"applied" | "duplicate" | "unmatched">;
  /**
   * Enregistre l'évènement et applique l'état, atomiquement. `duplicate` si
   * l'évènement a déjà été enregistré (livraisons concurrentes).
   */
  apply(
    event: { id: string; type: string },
    sync: SubscriptionSync | null,
  ): Promise<"applied" | "duplicate" | "unmatched">;
};

/** Le strict nécessaire du SDK Stripe (simulé dans les tests). */
export type StripeWebhookClient = {
  webhooks: Pick<Stripe["webhooks"], "constructEvent">;
  subscriptions: { retrieve(id: string): Promise<Stripe.Subscription> };
};

export type WebhookResult = { status: number; body: { received?: true; error?: string } };

const idOf = (value: string | { id: string } | null | undefined) =>
  typeof value === "string" ? value : (value?.id ?? null);

/** Abonnement concerné par l'évènement, et compte indiqué par Checkout. */
function subscriptionRef(event: Stripe.Event): { id: string | null; userId: string | null } {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      if (session.mode !== "subscription") return { id: null, userId: null };
      return { id: idOf(session.subscription), userId: session.client_reference_id ?? null };
    }
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      return { id: event.data.object.id, userId: null };
    case "invoice.payment_failed": {
      const invoice = event.data.object;
      const legacy = (invoice as { subscription?: string | { id: string } | null }).subscription;
      return {
        id: idOf(invoice.parent?.subscription_details?.subscription ?? legacy),
        userId: null,
      };
    }
    default:
      return { id: null, userId: null };
  }
}

/** Achat unitaire payé, s'il s'agit d'une session Checkout `mode=payment` d'un type connu. */
export function oneTimePaymentRef(event: Stripe.Event): OneTimePayment | null {
  if (event.type !== "checkout.session.completed") return null;
  const session = event.data.object;
  if (session.mode !== "payment" || session.payment_status !== "paid") return null;
  const kind = session.metadata?.kind;
  const paymentId = session.metadata?.paymentId;
  if (!kind || !(ONE_TIME_KINDS as readonly string[]).includes(kind) || !paymentId) return null;
  return {
    kind: kind as OneTimeKind,
    paymentId,
    checkoutSessionId: session.id,
    amountCents: typeof session.amount_total === "number" ? session.amount_total : null,
    currency: session.currency ? session.currency.toUpperCase() : null,
  };
}

function toStatus(value: string): SubscriptionStatusCode {
  const status = value.toUpperCase() as SubscriptionStatusCode;
  return SUBSCRIPTION_STATUSES.includes(status) ? status : "INCOMPLETE";
}

/** Fin de période : portée par les lignes de l'abonnement (API récentes) ou par l'abonnement. */
function periodEnd(subscription: Stripe.Subscription): Date | null {
  const ends = subscription.items.data
    .map((item) => item.current_period_end)
    .filter((v): v is number => typeof v === "number");
  const legacy = (subscription as { current_period_end?: number }).current_period_end;
  const seconds = ends.length > 0 ? Math.min(...ends) : legacy;
  return typeof seconds === "number" ? new Date(seconds * 1000) : null;
}

export function syncFromSubscription(
  subscription: Stripe.Subscription,
  userIdHint: string | null = null,
): SubscriptionSync {
  const status = toStatus(subscription.status);
  const metadataUserId = subscription.metadata?.userId;
  return {
    userId: metadataUserId || userIdHint,
    customerId: idOf(subscription.customer) ?? "",
    subscriptionId: subscription.id,
    status,
    plan: planForStatus(status),
    currentPeriodEnd: periodEnd(subscription),
    cancelAtPeriodEnd: subscription.cancel_at_period_end,
  };
}

export async function handleStripeWebhook(input: {
  payload: string;
  signature: string | null;
  secret: string;
  stripe: StripeWebhookClient;
  store: BillingStore;
  logger: Logger;
}): Promise<WebhookResult> {
  const { payload, signature, secret, stripe, store, logger } = input;
  if (!signature) return { status: 400, body: { error: "missingSignature" } };

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(payload, signature, secret);
  } catch {
    logger.warn("billing.webhook.invalidSignature");
    return { status: 400, body: { error: "invalidSignature" } };
  }

  if (!(HANDLED_EVENTS as readonly string[]).includes(event.type)) {
    return { status: 200, body: { received: true } };
  }
  if (await store.isProcessed(event.id)) {
    logger.info("billing.webhook.duplicate", { eventId: event.id, type: event.type });
    return { status: 200, body: { received: true } };
  }

  const payment = oneTimePaymentRef(event);
  if (payment && store.applyPayment) {
    const outcome = await store.applyPayment({ id: event.id, type: event.type }, payment);
    logger.info("billing.webhook.processed", {
      eventId: event.id,
      type: event.type,
      kind: payment.kind,
      outcome,
    });
    return { status: 200, body: { received: true } };
  }

  const ref = subscriptionRef(event);
  // État courant chez Stripe (une erreur réseau → 500 : Stripe renverra l'évènement).
  const sync = ref.id
    ? syncFromSubscription(await stripe.subscriptions.retrieve(ref.id), ref.userId)
    : null;
  const outcome = await store.apply({ id: event.id, type: event.type }, sync);
  logger.info("billing.webhook.processed", {
    eventId: event.id,
    type: event.type,
    outcome,
    plan: sync?.plan,
    status: sync?.status,
  });
  return { status: 200, body: { received: true } };
}
