"use server";

import { redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { billingConfigFromEnv } from "@/lib/billing/config";
import { getBillingAccount, saveStripeCustomerId } from "@/lib/billing/repository";
import { getEntitlements, getStripe } from "@/lib/billing/server";
import { siteUrl } from "@/lib/i18n/metadata";
import { logger } from "@/lib/logger";

/**
 * Paiement et gestion de l'abonnement : on redirige vers les pages hébergées
 * par Stripe (Checkout, portail client). Aucune donnée de carte ne transite
 * par nos serveurs ; Stripe ne reçoit que l'e-mail de connexion et
 * l'identifiant du compte (métadonnées). L'offre n'est JAMAIS modifiée ici :
 * seul le webhook la met à jour, d'après l'état chez Stripe.
 */

async function billingUrl(query = "") {
  const locale = await getLocale();
  return {
    locale,
    url: new URL(`/${locale}/app/billing${query}`, siteUrl()).toString(),
  };
}

async function fail(reason: "checkout" | "portal"): Promise<never> {
  const locale = await getLocale();
  return redirect({ href: `/app/billing?error=${reason}`, locale });
}

export async function startCheckout() {
  const user = await requireUser();
  const config = billingConfigFromEnv();
  const stripe = getStripe();
  if (!config || !stripe) return fail("checkout");
  // Déjà Premium (abonnement ou administrateur) : rien à payer.
  if ((await getEntitlements(user.id)).plan === "PREMIUM") {
    return redirect({ href: "/app/billing", locale: await getLocale() });
  }

  let checkoutUrl: string | null = null;
  try {
    const account = await getBillingAccount(user.id);
    let customerId = account?.stripeCustomerId ?? null;
    if (!customerId) {
      const customer = await stripe.customers.create(
        { email: user.email, metadata: { userId: user.id } },
        // Double clic : un seul client Stripe par compte.
        { idempotencyKey: `customer-${user.id}` },
      );
      customerId = await saveStripeCustomerId(user.id, customer.id);
    }
    if (!customerId) return fail("checkout");

    const { locale, url: success } = await billingUrl("?checkout=success");
    const { url: cancel } = await billingUrl("?checkout=cancel");
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      client_reference_id: user.id,
      line_items: [{ price: config.pricePremiumMonthly, quantity: 1 }],
      subscription_data: { metadata: { userId: user.id } },
      success_url: success,
      cancel_url: cancel,
      locale: locale as "fr",
      allow_promotion_codes: true,
    });
    checkoutUrl = session.url;
  } catch (error) {
    logger.error("billing.checkout.failed", { userId: user.id, error });
  }
  if (!checkoutUrl) return fail("checkout");
  logger.info("billing.checkout.started", { userId: user.id });
  redirectExternal(checkoutUrl);
}

export async function openPortal() {
  const user = await requireUser();
  const stripe = getStripe();
  const account = await getBillingAccount(user.id);
  if (!stripe || !account?.stripeCustomerId) return fail("portal");

  let portalUrl: string | null = null;
  try {
    const { locale, url } = await billingUrl();
    const session = await stripe.billingPortal.sessions.create({
      customer: account.stripeCustomerId,
      return_url: url,
      locale: locale as "fr",
    });
    portalUrl = session.url;
  } catch (error) {
    logger.error("billing.portal.failed", { userId: user.id, error });
  }
  if (!portalUrl) return fail("portal");
  redirectExternal(portalUrl);
}
