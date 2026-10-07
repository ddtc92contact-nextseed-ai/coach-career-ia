/**
 * Réglages de l'espace entreprise, lus UNIQUEMENT dans l'environnement.
 * Module sans dépendance serveur : testable.
 */

type Env = Record<string, string | undefined>;

export const DEFAULT_POSTING_DURATION_DAYS = 30;
/** Prix fictif par défaut d'une publication (phase de test). */
export const DEFAULT_JOB_POSTING_PRICE_CENTS = 9900;
export const DEFAULT_JOB_POSTING_CURRENCY = "EUR";

/** Durée d'une publication, en jours (`JOB_POSTING_DURATION_DAYS`, 1 à 365). */
export function postingDurationDays(env: Env = process.env): number {
  const raw = Number(env.JOB_POSTING_DURATION_DAYS?.trim());
  return Number.isInteger(raw) && raw >= 1 && raw <= 365 ? raw : DEFAULT_POSTING_DURATION_DAYS;
}

export type JobPostingPrice = { amountCents: number; currency: string };

/** Prix d'une publication (`JOB_POSTING_PRICE_CENTS`, `JOB_POSTING_CURRENCY`). */
export function jobPostingPriceFromEnv(env: Env = process.env): JobPostingPrice {
  const cents = Number(env.JOB_POSTING_PRICE_CENTS?.trim());
  const currency = env.JOB_POSTING_CURRENCY?.trim().toUpperCase();
  return {
    amountCents: Number.isInteger(cents) && cents > 0 ? cents : DEFAULT_JOB_POSTING_PRICE_CENTS,
    currency: currency && /^[A-Z]{3}$/.test(currency) ? currency : DEFAULT_JOB_POSTING_CURRENCY,
  };
}

/** Préfixe des offres publiées directement (`job_offers.source`, `source_key`). */
export const DIRECT_SOURCE = "direct";
export const directSourceKey = (orgId: string) => `${DIRECT_SOURCE}:${orgId}`;
