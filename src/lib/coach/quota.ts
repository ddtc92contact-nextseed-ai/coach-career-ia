/**
 * Quota de messages du coach : LE seul endroit où la limite est définie
 * (future offre premium : la limite dépendra du plan de l'utilisateur).
 *
 * `COACH_MESSAGES_PER_DAY` : messages envoyés par utilisateur sur 24 h
 * glissantes (40 par défaut ; 0 désactive le coach). Le décompte se fait en
 * base (`coach_messages`), il survit donc aux redémarrages.
 */

export const DEFAULT_COACH_MESSAGES_PER_DAY = 40;
export const COACH_QUOTA_WINDOW_MS = 24 * 3_600_000;

export function coachMessagesPerDay(env: Record<string, string | undefined> = process.env): number {
  const raw = env.COACH_MESSAGES_PER_DAY?.trim();
  if (!raw) return DEFAULT_COACH_MESSAGES_PER_DAY;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_COACH_MESSAGES_PER_DAY;
}

/** Messages restants, d'après le nombre déjà envoyés dans la fenêtre. */
export function remainingMessages(sentInWindow: number, limit = coachMessagesPerDay()): number {
  return Math.max(0, limit - sentInWindow);
}
