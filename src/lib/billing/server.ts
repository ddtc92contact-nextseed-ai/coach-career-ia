import "server-only";
import { cache } from "react";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { billingConfigFromEnv, billingMode, isSimulatedId } from "./config";
import { entitlementsFor, type Entitlements } from "./entitlements";
import { settleDueSimulatedSubscription } from "./simulator-server";

/**
 * Point d'entrée serveur de la facturation. `server-only` : la clé Stripe ne
 * peut pas finir dans le bundle client.
 */

/**
 * Droits de l'utilisateur (offre enregistrée + `ADMIN_EMAILS`). À utiliser
 * par TOUTE fonctionnalité soumise à l'offre. Mémoïsé pour la requête.
 */
export const getEntitlements = cache(async (userId: string): Promise<Entitlements> => {
  if (billingMode() === "simulator") {
    // Échéance passée dans le simulateur : appliquée avant de lire l'offre.
    await settleDueSimulatedSubscription(userId).catch((error: unknown) =>
      logger.error("billing.simulator.settleFailed", { userId, error }),
    );
  }
  const account = await db.user.findUnique({
    where: { id: userId },
    select: { email: true, plan: true },
  });
  return entitlementsFor(account ?? { email: "", plan: "FREE" });
});

let client: { key: string; stripe: Stripe } | undefined;

/** Client Stripe, ou `null` si la facturation n'est pas configurée. */
export function getStripe(): Stripe | null {
  const config = billingConfigFromEnv();
  if (!config) return null;
  if (client?.key !== config.secretKey) {
    client = {
      key: config.secretKey,
      stripe: new Stripe(config.secretKey, {
        maxNetworkRetries: 2,
        timeout: 20_000,
        appInfo: { name: "coach-career-ia" },
      }),
    };
  }
  return client.stripe;
}

export type PremiumPrice = {
  /** Montant en unités monétaires (9.9), pas en centimes. */
  amount: number;
  currency: string;
  /** `day`, `week`, `month` ou `year` (libellé traduit, « mois » par défaut). */
  interval: string;
};

const PRICE_TTL_MS = 3_600_000;
let priceCache: { id: string; at: number; value: PremiumPrice | null } | undefined;

/**
 * Prix mensuel Premium, lu chez Stripe (une heure en cache). `null` s'il est
 * illisible : la page l'affiche alors sans montant.
 */
export async function getPremiumPrice(): Promise<PremiumPrice | null> {
  const config = billingConfigFromEnv();
  const stripe = getStripe();
  if (!config || !stripe) return null;
  const id = config.pricePremiumMonthly;
  if (priceCache?.id === id && Date.now() - priceCache.at < PRICE_TTL_MS) return priceCache.value;
  let value: PremiumPrice | null = null;
  try {
    const price = await stripe.prices.retrieve(id);
    if (price.unit_amount !== null && price.recurring) {
      value = {
        amount: price.unit_amount / 100,
        currency: price.currency.toUpperCase(),
        interval: price.recurring.interval,
      };
    }
  } catch (error) {
    logger.warn("billing.price.unavailable", { error });
  }
  priceCache = { id, at: Date.now(), value };
  return value;
}

/**
 * Suppression du compte : supprime le client Stripe, ce qui résilie aussitôt
 * tout abonnement (plus aucun prélèvement) et efface l'e-mail chez Stripe.
 * `false` si Stripe n'a pas pu être joint : la suppression du compte doit
 * alors être refusée, sans quoi l'abonnement continuerait d'être prélevé.
 */
export async function closeStripeCustomer(
  userId: string,
  stripe: Pick<Stripe, "customers"> | null = getStripe(),
): Promise<boolean> {
  const account = await db.user.findUnique({
    where: { id: userId },
    select: { stripeCustomerId: true },
  });
  const customerId = account?.stripeCustomerId;
  // Client du simulateur : rien chez Stripe (l'état simulé part avec le compte).
  if (!customerId || isSimulatedId(customerId)) return true;
  if (!stripe) {
    logger.warn("billing.customer.notClosed", { userId, reason: "billingNotConfigured" });
    return true;
  }
  try {
    await stripe.customers.del(customerId);
    return true;
  } catch (error) {
    if ((error as { code?: string }).code === "resource_missing") return true;
    logger.error("billing.customer.closeFailed", { userId, error });
    return false;
  }
}
