import "server-only";
import type { CurrentUser } from "@/lib/auth/session";
import { siteUrl } from "@/lib/i18n/metadata";
import { logger } from "@/lib/logger";
import {
  billingConfigFromEnv,
  billingMode,
  isSimulatedId,
  simulatedPriceFromEnv,
  type BillingMode,
  type BillingProviderName,
} from "./config";
import { getBillingAccount, saveStripeCustomerId } from "./repository";
import { closeStripeCustomer, getPremiumPrice, getStripe, type PremiumPrice } from "./server";
import {
  createSimulatedCheckout,
  getCurrentSimulatedSubscription,
  applySimulatorAction,
} from "./simulator-server";
import { simId } from "./simulator";

/**
 * Fournisseur de paiement : Stripe ou son simulateur (`BILLING_PROVIDER`).
 * Les deux ouvrent un paiement et un espace de gestion, et résilient ; l'offre
 * n'est JAMAIS modifiée ici : seul le traitement des évènements de paiement
 * (`handleStripeWebhook`, commun aux deux) la met à jour.
 */

/** Où envoyer le navigateur : page hébergée par Stripe, ou page du simulateur. */
export type BillingRedirect =
  { kind: "external"; url: string } | { kind: "internal"; href: string };

/** Achat unitaire d'une publication d'offre (Checkout `mode=payment`). */
export type JobPostingCheckoutInput = {
  user: CurrentUser;
  /** Achat déjà enregistré (`job_posting_payments`, statut `PENDING`). */
  paymentId: string;
  postingId: string;
  amountCents: number;
  currency: string;
  /** Libellé affiché sur la page de paiement (intitulé de l'offre). */
  label: string;
  locale: string;
};

export type OneTimeCheckout = { checkoutSessionId: string; redirect: BillingRedirect };

export type BillingProvider = {
  name: BillingProviderName;
  /** Page de paiement d'une publication d'offre ; `null` si elle n'a pas pu être ouverte. */
  createJobPostingCheckout(input: JobPostingCheckoutInput): Promise<OneTimeCheckout | null>;
  /** Prix mensuel de Premium, `null` s'il est inconnu. */
  getPremiumPrice(): Promise<PremiumPrice | null>;
  /** Page de paiement ; `null` si elle n'a pas pu être ouverte. */
  createCheckout(user: CurrentUser, locale: string): Promise<BillingRedirect | null>;
  /** Gestion de l'abonnement (résiliation…) ; `null` si indisponible. */
  openPortal(user: CurrentUser, locale: string): Promise<BillingRedirect | null>;
  /** Résiliation immédiate (suppression du compte) ; `false` = échec, ne pas supprimer. */
  cancel(userId: string): Promise<boolean>;
  /** Le compte a un client chez ce fournisseur (bouton « Gérer mon abonnement »). */
  canManage(account: { stripeCustomerId: string | null }): boolean;
};

const billingUrl = (locale: string, query = "") =>
  new URL(`/${locale}/app/billing${query}`, siteUrl()).toString();

const postingUrl = (locale: string, postingId: string, query: string) =>
  new URL(`/${locale}/entreprise/offres/${postingId}?${query}`, siteUrl()).toString();

export const stripeProvider: BillingProvider = {
  name: "stripe",
  getPremiumPrice,

  async createJobPostingCheckout(input) {
    const stripe = getStripe();
    if (!stripe) return null;
    try {
      const session = await stripe.checkout.sessions.create(
        {
          mode: "payment",
          client_reference_id: input.user.id,
          customer_email: input.user.email,
          line_items: [
            {
              quantity: 1,
              price_data: {
                currency: input.currency.toLowerCase(),
                unit_amount: input.amountCents,
                product_data: { name: input.label.slice(0, 250) },
              },
            },
          ],
          metadata: { kind: "job_posting", paymentId: input.paymentId },
          payment_intent_data: { metadata: { kind: "job_posting", paymentId: input.paymentId } },
          success_url: postingUrl(input.locale, input.postingId, "paiement=ok"),
          cancel_url: postingUrl(input.locale, input.postingId, "paiement=annule"),
          locale: input.locale as "fr",
        },
        // Double clic : une seule session par achat.
        { idempotencyKey: `job-posting-${input.paymentId}` },
      );
      return session.url
        ? { checkoutSessionId: session.id, redirect: { kind: "external", url: session.url } }
        : null;
    } catch (error) {
      logger.error("billing.jobPosting.checkoutFailed", { userId: input.user.id, error });
      return null;
    }
  },

  async createCheckout(user, locale) {
    const config = billingConfigFromEnv();
    const stripe = getStripe();
    if (!config || !stripe) return null;
    try {
      const account = await getBillingAccount(user.id);
      // Un client du simulateur (phase de test) n'existe pas chez Stripe.
      let customerId = isSimulatedId(account?.stripeCustomerId)
        ? null
        : (account?.stripeCustomerId ?? null);
      if (!customerId) {
        const customer = await stripe.customers.create(
          { email: user.email, metadata: { userId: user.id } },
          // Double clic : un seul client Stripe par compte.
          { idempotencyKey: `customer-${user.id}` },
        );
        customerId = await saveStripeCustomerId(user.id, customer.id);
      }
      if (!customerId) return null;

      const session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customerId,
        client_reference_id: user.id,
        line_items: [{ price: config.pricePremiumMonthly, quantity: 1 }],
        subscription_data: { metadata: { userId: user.id } },
        success_url: billingUrl(locale, "?checkout=success"),
        cancel_url: billingUrl(locale, "?checkout=cancel"),
        locale: locale as "fr",
        allow_promotion_codes: true,
      });
      return session.url ? { kind: "external", url: session.url } : null;
    } catch (error) {
      logger.error("billing.checkout.failed", { userId: user.id, error });
      return null;
    }
  },

  async openPortal(user, locale) {
    const stripe = getStripe();
    const account = await getBillingAccount(user.id);
    const customerId = account?.stripeCustomerId;
    if (!stripe || !customerId || isSimulatedId(customerId)) return null;
    try {
      const session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: billingUrl(locale),
        locale: locale as "fr",
      });
      return { kind: "external", url: session.url };
    } catch (error) {
      logger.error("billing.portal.failed", { userId: user.id, error });
      return null;
    }
  },

  cancel: (userId) => closeStripeCustomer(userId),

  canManage: ({ stripeCustomerId }) =>
    Boolean(stripeCustomerId) && !isSimulatedId(stripeCustomerId),
};

export const simulatorProvider: BillingProvider = {
  name: "simulator",
  getPremiumPrice: async () => simulatedPriceFromEnv(),

  async createJobPostingCheckout() {
    const checkoutSessionId = simId("cs");
    return {
      checkoutSessionId,
      redirect: { kind: "internal", href: `/entreprise/paiement/${checkoutSessionId}` },
    };
  },

  async createCheckout(user) {
    const session = await createSimulatedCheckout(user.id);
    return session
      ? { kind: "internal", href: `/app/billing/simulation/paiement/${session}` }
      : null;
  },

  async openPortal(user) {
    const account = await getBillingAccount(user.id);
    if (!isSimulatedId(account?.stripeCustomerId)) return null;
    return { kind: "internal", href: "/app/billing/simulation/portail" };
  },

  async cancel(userId) {
    // Rien n'est prélevé : un échec n'empêche pas la suppression (l'état simulé part avec le compte).
    try {
      if (await getCurrentSimulatedSubscription(userId)) {
        await applySimulatorAction(userId, "cancelNow");
      }
    } catch (error) {
      logger.warn("billing.simulator.cancelFailed", { userId, error });
    }
    return true;
  },

  canManage: ({ stripeCustomerId }) => isSimulatedId(stripeCustomerId),
};

/** Fournisseur actif, ou `null` si les paiements sont indisponibles. */
export function getBillingProvider(mode: BillingMode = billingMode()): BillingProvider | null {
  if (mode === "simulator") return simulatorProvider;
  if (mode === "stripe") return stripeProvider;
  return null;
}

/**
 * Suppression du compte : résilie chez le fournisseur qui détient le client
 * (d'après l'identifiant enregistré), quel que soit le fournisseur actif.
 */
export async function cancelBillingForAccountDeletion(userId: string): Promise<boolean> {
  const account = await getBillingAccount(userId);
  return isSimulatedId(account?.stripeCustomerId)
    ? simulatorProvider.cancel(userId)
    : stripeProvider.cancel(userId);
}
