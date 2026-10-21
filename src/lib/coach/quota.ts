/**
 * Quota de messages du coach de l'offre GRATUITE. La limite appliquée à un
 * utilisateur vient de ses droits (`getEntitlements()` → `limits`) : Premium
 * est illimité.
 *
 * `COACH_MESSAGES_PER_DAY` : messages envoyés par utilisateur sur 24 h
 * glissantes (5 par défaut ; 0 réserve le coach à Premium). Le décompte se
 * fait en base (`coach_messages`), il survit donc aux redémarrages.
 */

export const DEFAULT_COACH_MESSAGES_PER_DAY = 5;
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

/**
 * Fenêtre glissante : instant où un message gratuit se libère de nouveau,
 * d'après les dates d'envoi de la fenêtre (dans n'importe quel ordre) ;
 * `null` s'il en reste, si c'est illimité ou si le coach est réservé à Premium.
 */
export function quotaResetAt(sentAt: readonly Date[], limit: number | null): Date | null {
  if (limit === null || limit === 0 || sentAt.length < limit) return null;
  const sorted = [...sentAt].sort((a, b) => a.getTime() - b.getTime());
  // Le message qui, en sortant de la fenêtre, ramène le décompte sous la limite.
  return new Date(sorted[sentAt.length - limit]!.getTime() + COACH_QUOTA_WINDOW_MS);
}
