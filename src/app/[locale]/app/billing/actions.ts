"use server";

import { redirect as redirectExternal } from "next/navigation";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { requireUser } from "@/lib/auth/session";
import { getBillingProvider, type BillingRedirect } from "@/lib/billing/provider";
import { getEntitlements } from "@/lib/billing/server";
import { logger } from "@/lib/logger";

/**
 * Paiement et gestion de l'abonnement, chez le fournisseur actif : pages
 * hébergées par Stripe (Checkout, portail client), ou pages du simulateur en
 * phase de test. Aucune donnée de carte ne transite par nos serveurs. L'offre
 * n'est JAMAIS modifiée ici : seul le traitement des évènements de paiement
 * la met à jour.
 */

async function fail(reason: "checkout" | "portal"): Promise<never> {
  const locale = await getLocale();
  return redirect({ href: `/app/billing?error=${reason}`, locale });
}

async function go(target: BillingRedirect): Promise<never> {
  if (target.kind === "internal") return redirect({ href: target.href, locale: await getLocale() });
  return redirectExternal(target.url);
}

export async function startCheckout() {
  const user = await requireUser();
  const provider = getBillingProvider();
  if (!provider) return fail("checkout");
  const locale = await getLocale();
  // Déjà Premium (abonnement ou administrateur) : rien à payer.
  if ((await getEntitlements(user.id)).plan === "PREMIUM") {
    return redirect({ href: "/app/billing", locale });
  }
  const target = await provider.createCheckout(user, locale);
  if (!target) return fail("checkout");
  logger.info("billing.checkout.started", { userId: user.id, provider: provider.name });
  return go(target);
}

export async function openPortal() {
  const user = await requireUser();
  const provider = getBillingProvider();
  if (!provider) return fail("portal");
  const locale = await getLocale();
  const target = await provider.openPortal(user, locale);
  if (!target) return fail("portal");
  return go(target);
}
