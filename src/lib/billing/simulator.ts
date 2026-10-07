import { randomBytes } from "node:crypto";
import Stripe from "stripe";
import type { Logger } from "@/lib/logger";
import { SIMULATOR_ID_PREFIX } from "./config";
import {
  handleStripeWebhook,
  type BillingStore,
  type StripeWebhookClient,
  type SubscriptionStatusCode,
} from "./webhook";

/**
 * Simulateur de paiement (phase de test, `BILLING_PROVIDER=simulator`).
 *
 * Il joue le rôle de Stripe : il tient l'état de l'abonnement, émet les MÊMES
 * évènements que Stripe (mêmes types, même forme JSON, signés) et les fait
 * traiter par le MÊME code que le webhook (`handleStripeWebhook`), qui relit
 * l'abonnement chez le « Stripe » simulé. Les droits sont donc calculés
 * exactement comme en production.
 *
 * Module sans base de données : transitions et évènements sont testables.
 */

export type SimSubscription = {
  id: string;
  userId: string;
  customerId: string;
  checkoutSessionId: string;
  status: SubscriptionStatusCode;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: Date | null;
};

export const simId = (kind: "cus" | "sub" | "cs" | "evt" | "in") =>
  `${SIMULATOR_ID_PREFIX}${kind}_${randomBytes(12).toString("hex")}`;

const seconds = (date: Date) => Math.floor(date.getTime() / 1000);

/** Fin de période un mois plus tard (le prix simulé est mensuel). */
export function addOneMonth(date: Date): Date {
  const next = new Date(date);
  next.setUTCMonth(next.getUTCMonth() + 1);
  return next;
}

/** L'abonnement tel que l'API Stripe le renverrait (`subscriptions.retrieve`). */
export function toStripeSubscription(sub: SimSubscription): Stripe.Subscription {
  return {
    id: sub.id,
    object: "subscription",
    customer: sub.customerId,
    status: sub.status.toLowerCase(),
    cancel_at_period_end: sub.cancelAtPeriodEnd,
    metadata: { userId: sub.userId },
    items: {
      object: "list",
      data: sub.currentPeriodEnd
        ? [
            {
              id: `${sub.id}_item`,
              object: "subscription_item",
              current_period_end: seconds(sub.currentPeriodEnd),
            },
          ]
        : [],
    },
  } as unknown as Stripe.Subscription;
}

export const SIMULATED_EVENTS = [
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
  "invoice.payment_failed",
] as const;
export type SimEventType = (typeof SIMULATED_EVENTS)[number];

/** Évènement au format Stripe (cf. `tests/fixtures/stripe`). */
export function simulatorEvent(
  type: SimEventType,
  sub: SimSubscription,
  now: Date = new Date(),
  id: string = simId("evt"),
) {
  let object: Record<string, unknown>;
  switch (type) {
    case "checkout.session.completed":
      object = {
        id: sub.checkoutSessionId,
        object: "checkout.session",
        mode: "subscription",
        status: "complete",
        payment_status: "paid",
        client_reference_id: sub.userId,
        customer: sub.customerId,
        subscription: sub.id,
      };
      break;
    case "invoice.payment_failed":
      object = {
        id: simId("in"),
        object: "invoice",
        customer: sub.customerId,
        status: "open",
        parent: {
          type: "subscription_details",
          quote_details: null,
          subscription_details: { subscription: sub.id, metadata: {} },
        },
      };
      break;
    default:
      object = toStripeSubscription(sub) as unknown as Record<string, unknown>;
  }
  return {
    id,
    object: "event",
    type,
    api_version: "simulator",
    created: seconds(now),
    livemode: false,
    pending_webhooks: 1,
    request: { id: null, idempotency_key: null },
    data: { object },
  };
}

/**
 * Actions possibles, et ce qu'elles déclenchent chez Stripe :
 * - `pay` : paiement accepté sur la page de paiement simulée ;
 * - `cancelAtPeriodEnd` / `resume` / `cancelNow` / `payOutstanding` : portail ;
 * - `periodEnd` : la fin de période arrive (renouvellement payé, fin d'un
 *   abonnement résilié, ou relances épuisées après un échec) ;
 * - `failRenewal` : le renouvellement est refusé par la banque.
 */
export const SIM_ACTIONS = [
  "pay",
  "cancelAtPeriodEnd",
  "resume",
  "cancelNow",
  "payOutstanding",
  "periodEnd",
  "failRenewal",
] as const;
export type SimAction = (typeof SIM_ACTIONS)[number];

export type SimTransition = {
  next: Pick<SimSubscription, "status" | "cancelAtPeriodEnd" | "currentPeriodEnd">;
  events: SimEventType[];
};

const LIVE: ReadonlySet<SubscriptionStatusCode> = new Set(["ACTIVE", "TRIALING", "PAST_DUE"]);

/** Statuts d'un abonnement en cours (non terminé). */
export const LIVE_STATUSES = [...LIVE];

/** Nouvel état et évènements émis ; `null` si l'action n'a pas de sens dans cet état. */
export function transition(
  sub: Pick<SimSubscription, "status" | "cancelAtPeriodEnd" | "currentPeriodEnd">,
  action: SimAction,
  now: Date = new Date(),
): SimTransition | null {
  const { status, cancelAtPeriodEnd, currentPeriodEnd } = sub;
  const active = status === "ACTIVE" || status === "TRIALING";
  switch (action) {
    case "pay":
      if (status !== "INCOMPLETE") return null;
      return {
        next: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd: addOneMonth(now) },
        // Ordre de Stripe : l'abonnement est créé, puis la session de paiement terminée.
        events: ["customer.subscription.created", "checkout.session.completed"],
      };
    case "cancelAtPeriodEnd":
      if (!active || cancelAtPeriodEnd) return null;
      return {
        next: { status, cancelAtPeriodEnd: true, currentPeriodEnd },
        events: ["customer.subscription.updated"],
      };
    case "resume":
      if (!active || !cancelAtPeriodEnd) return null;
      return {
        next: { status, cancelAtPeriodEnd: false, currentPeriodEnd },
        events: ["customer.subscription.updated"],
      };
    case "cancelNow":
      if (!LIVE.has(status)) return null;
      return {
        next: { status: "CANCELED", cancelAtPeriodEnd: false, currentPeriodEnd },
        events: ["customer.subscription.deleted"],
      };
    case "payOutstanding":
      if (status !== "PAST_DUE") return null;
      return {
        next: { status: "ACTIVE", cancelAtPeriodEnd: false, currentPeriodEnd },
        events: ["customer.subscription.updated"],
      };
    case "periodEnd":
      if (status === "PAST_DUE") {
        // Relances épuisées : Stripe marque l'abonnement impayé (→ offre gratuite).
        return {
          next: { status: "UNPAID", cancelAtPeriodEnd: false, currentPeriodEnd },
          events: ["customer.subscription.updated"],
        };
      }
      if (!active) return null;
      if (cancelAtPeriodEnd) {
        return {
          next: { status: "CANCELED", cancelAtPeriodEnd: false, currentPeriodEnd },
          events: ["customer.subscription.deleted"],
        };
      }
      // Renouvellement payé : nouvelle période d'un mois.
      return {
        next: { status, cancelAtPeriodEnd: false, currentPeriodEnd: addOneMonth(now) },
        events: ["customer.subscription.updated"],
      };
    case "failRenewal":
      // Un abonnement résilié ne se renouvelle pas : pas de prélèvement à refuser.
      if (!active || cancelAtPeriodEnd) return null;
      // Stripe passe à la période suivante, facture impayée, relances en cours.
      return {
        next: { status: "PAST_DUE", cancelAtPeriodEnd: false, currentPeriodEnd: addOneMonth(now) },
        events: ["invoice.payment_failed", "customer.subscription.updated"],
      };
  }
}

/** Échéance passée : ce que Stripe aurait fait de lui-même à la fin de période. */
export function isDue(
  sub: Pick<SimSubscription, "status" | "currentPeriodEnd">,
  now: Date = new Date(),
): boolean {
  return LIVE.has(sub.status) && sub.currentPeriodEnd !== null && sub.currentPeriodEnd <= now;
}

// Signature locale des évènements simulés (secret propre au processus) : ils
// passent la même vérification que ceux de Stripe.
const SIGNING_SECRET = `whsec_${SIMULATOR_ID_PREFIX}${randomBytes(24).toString("hex")}`;
let sdk: Stripe | undefined;
const webhooks = () => (sdk ??= new Stripe(`sk_${SIMULATOR_ID_PREFIX}never_used`)).webhooks;

/** Client « Stripe » du simulateur : relit l'abonnement dans l'état simulé. */
export function simulatorClient(
  lookup: (subscriptionId: string) => Promise<SimSubscription | null>,
): StripeWebhookClient {
  return {
    webhooks: webhooks(),
    subscriptions: {
      async retrieve(id) {
        const sub = await lookup(id);
        if (!sub) throw new Error("simulator.subscriptionNotFound");
        return toStripeSubscription(sub);
      },
    },
  };
}

/**
 * Livre les évènements au traitement du webhook, comme Stripe le ferait.
 * Une erreur interrompt la livraison (l'état simulé reste la référence : il
 * sera relu au prochain évènement).
 */
export async function deliverSimulatorEvents(input: {
  events: ReturnType<typeof simulatorEvent>[];
  lookup: (subscriptionId: string) => Promise<SimSubscription | null>;
  store: BillingStore;
  logger: Logger;
}) {
  const client = simulatorClient(input.lookup);
  const results = [];
  for (const event of input.events) {
    const payload = JSON.stringify(event);
    const signature = webhooks().generateTestHeaderString({
      payload,
      secret: SIGNING_SECRET,
    });
    results.push(
      await handleStripeWebhook({
        payload,
        signature,
        secret: SIGNING_SECRET,
        stripe: client,
        store: input.store,
        logger: input.logger,
      }),
    );
  }
  return results;
}
