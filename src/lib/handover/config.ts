/**
 * Levée d'anonymat : durée de validité du lien et des données révélées
 * (`HANDOVER_TTL_DAYS`, 30 jours par défaut, 1 à 365), chemins publics.
 */

export const DEFAULT_HANDOVER_TTL_DAYS = 30;

export function handoverTtlDays(env: Record<string, string | undefined> = process.env): number {
  const value = Number(env.HANDOVER_TTL_DAYS?.trim());
  return Number.isInteger(value) && value >= 1 && value <= 365 ? value : DEFAULT_HANDOVER_TTL_DAYS;
}

/** Page « profil révélé » (publique, à jeton, noindex). */
export const revealedPath = (locale: string, token: string) => `/${locale}/r/${token}`;
/** Téléchargement du CV révélé. */
export const revealedCvPath = (token: string) => `/api/r/${token}/cv`;
