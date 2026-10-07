/**
 * Configuration de la facturation, lue UNIQUEMENT dans l'environnement. Sans les trois
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

/**
 * Fournisseur de paiement, choisi par `BILLING_PROVIDER` :
 * - `simulator` (défaut, variable absente) : Stripe émulé, sans compte ni clé,
 *   pour la phase de test ; aucun prélèvement réel ;
 * - `stripe` : vrai Stripe, seulement si ses trois variables sont présentes ;
 *   sinon `unavailable` (paiements indisponibles, rien ne plante).
 * Une valeur inconnue donne `unavailable` : on ne simule jamais par erreur.
 */
export type BillingProviderName = "simulator" | "stripe";
export type BillingMode = BillingProviderName | "unavailable";

export function billingMode(env: Env = process.env): BillingMode {
  const raw = env.BILLING_PROVIDER?.trim().toLowerCase();
  if (!raw || raw === "simulator") return "simulator";
  if (raw === "stripe") return isBillingConfigured(env) ? "stripe" : "unavailable";
  return "unavailable";
}

/** Un abonnement peut être souscrit (simulateur ou Stripe configuré). */
export function isBillingAvailable(env: Env = process.env): boolean {
  return billingMode(env) !== "unavailable";
}

/** Prix Premium affiché par le simulateur (`BILLING_PREMIUM_PRICE_CENTS`, `BILLING_CURRENCY`). */
export const DEFAULT_SIMULATED_PRICE_CENTS = 900;
export const DEFAULT_SIMULATED_CURRENCY = "EUR";

export function simulatedPriceFromEnv(env: Env = process.env): {
  amount: number;
  currency: string;
  interval: "month";
} {
  const rawCents = env.BILLING_PREMIUM_PRICE_CENTS?.trim();
  const cents = rawCents ? Number(rawCents) : NaN;
  const rawCurrency = env.BILLING_CURRENCY?.trim().toUpperCase();
  return {
    amount: (Number.isInteger(cents) && cents > 0 ? cents : DEFAULT_SIMULATED_PRICE_CENTS) / 100,
    currency:
      rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : DEFAULT_SIMULATED_CURRENCY,
    interval: "month",
  };
}

/** Identifiants (client, abonnement, session…) créés par le simulateur. */
export const SIMULATOR_ID_PREFIX = "sim_";

export const isSimulatedId = (id: string | null | undefined): boolean =>
  typeof id === "string" && id.startsWith(SIMULATOR_ID_PREFIX);
