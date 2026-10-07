/**
 * Quotas de prise de contact : l'application ne doit jamais ressembler à un
 * robot d'envoi.
 *
 * `CONTACT_DAILY_LIMIT` : messages envoyés par l'application, par candidat,
 * sur 24 h glissantes (5 par défaut ; 0 désactive l'envoi). Une seule prise de
 * contact par offre, quel que soit le canal. Les textes que le candidat colle
 * lui-même sur une page « Postuler » ne sont pas envoyés par l'application et
 * ne comptent pas dans le quota.
 */

export const DEFAULT_CONTACT_DAILY_LIMIT = 5;
export const CONTACT_QUOTA_WINDOW_MS = 24 * 3_600_000;
/** Réponses acceptées par prise de contact sur 24 h (anti-abus de la page publique). */
export const MAX_REPLIES_PER_DAY = 10;
export const MAX_REPLY_LENGTH = 5_000;

export function contactDailyLimit(env: Record<string, string | undefined> = process.env): number {
  const raw = env.CONTACT_DAILY_LIMIT?.trim();
  if (!raw) return DEFAULT_CONTACT_DAILY_LIMIT;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 && value <= 100
    ? value
    : DEFAULT_CONTACT_DAILY_LIMIT;
}

/** Envois restants, d'après le nombre d'envois dans la fenêtre. */
export function remainingContacts(sentInWindow: number, limit: number): number {
  return Math.max(0, limit - sentInWindow);
}
