/**
 * Configuration Stripe, lue UNIQUEMENT dans l'environnement. Sans les trois
 * variables, la facturation est simplement indisponible : l'application
 * fonctionne, la page « Abonnement » l'indique et personne n'est bloqué.
 */

export type BillingConfig = {
  secretKey: string;
  webhookSecret: string;
  pricePremiumMonthly: string;
};

type Env = Record<string, string | undefined>;

export function billingConfigFromEnv(env: Env = process.env): BillingConfig | null {
  const secretKey = env.STRIPE_SECRET_KEY?.trim();
  const webhookSecret = env.STRIPE_WEBHOOK_SECRET?.trim();
  const pricePremiumMonthly = env.STRIPE_PRICE_PREMIUM_MONTHLY?.trim();
  if (!secretKey || !webhookSecret || !pricePremiumMonthly) return null;
  return { secretKey, webhookSecret, pricePremiumMonthly };
}

export function isBillingConfigured(env: Env = process.env): boolean {
  return billingConfigFromEnv(env) !== null;
}
