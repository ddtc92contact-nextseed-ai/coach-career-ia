/**
 * Quota de messages du coach de l'offre GRATUITE. La limite appliquée à un
 * utilisateur vient de ses droits (`getEntitlements()` → `limits`) : Premium
 * est illimité.
 *
 * `COACH_MESSAGES_PER_DAY` : messages envoyés par utilisateur sur 24 h
 * glissantes (40 par défaut ; 0 réserve le coach à Premium). Le décompte se
 * fait en base (`coach_messages`), il survit donc aux redémarrages.
 */

export const DEFAULT_COACH_MESSAGES_PER_DAY = 40;
export const COACH_QUOTA_WINDOW_MS = 24 * 3_600_000;

export function coachMessagesPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env.COACH_MESSAGES_PER_DAY?.trim();
  if (!raw) return DEFAULT_COACH_MESSAGES_PER_DAY;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_COACH_MESSAGES_PER_DAY;
}

/**
 * Messages restants, d'après le nombre déjà envoyés dans la fenêtre ;
 * `null` si la limite est `null` (illimité).
 */
export function remainingMessages(sentInWindow: number, limit: number): number;
export function remainingMessages(sentInWindow: number, limit: number | null): number | null;
export function remainingMessages(sentInWindow: number, limit: number | null): number | null {
  return limit === null ? null : Math.max(0, limit - sentInWindow);
}
