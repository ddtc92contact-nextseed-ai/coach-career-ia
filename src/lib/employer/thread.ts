/**
 * Statut d'un fil de la messagerie de l'espace entreprise, tel que
 * l'organisation le voit (module pur, testable) :
 * nouveau → lu (ouvert par un membre) → répondu → clos.
 */

export const THREAD_STATUSES = ["NEW", "READ", "REPLIED", "CLOSED"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export function threadStatus(row: {
  orgReadAt: Date | null;
  orgClosedAt: Date | null;
  replies: number;
}): ThreadStatus {
  if (row.orgClosedAt) return "CLOSED";
  if (row.replies > 0) return "REPLIED";
  if (row.orgReadAt) return "READ";
  return "NEW";
}
