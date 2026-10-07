/**
 * Cycle de vie d'une offre publiée directement par une entreprise.
 *
 *   DRAFT ──submit──▶ AWAITING_PAYMENT ──paid──▶ IN_REVIEW ──approve──▶ LIVE
 *     ▲                                    └─(rien de signalé, org active)─▶ LIVE
 *     └──edit── REJECTED ◀──reject── (IN_REVIEW, AWAITING_PAYMENT, LIVE)
 *   LIVE ──close / expire / suspension──▶ CLOSED ──renew──▶ AWAITING_PAYMENT
 *   LIVE ──paid (renouvellement)──▶ LIVE, échéance prolongée
 *
 * Règle d'or : une offre n'est en ligne (`LIVE`) que si la période en cours
 * est PAYÉE, la modération PASSÉE et l'organisation ACTIVE. Modération
 * automatique quand rien n'est signalé (critères discriminatoires) sur une
 * organisation vérifiée, et que l'offre n'a pas déjà été refusée par un
 * administrateur ; sinon, revue manuelle.
 *
 * Module pur, sans base : chaque transition renvoie le nouvel état (ou `null`
 * si l'action n'a pas de sens dans l'état courant).
 */

export const POSTING_STATUSES = [
  "DRAFT",
  "AWAITING_PAYMENT",
  "IN_REVIEW",
  "LIVE",
  "CLOSED",
  "REJECTED",
] as const;
export type PostingStatus = (typeof POSTING_STATUSES)[number];
export type OrgStatus = "PENDING" | "ACTIVE" | "SUSPENDED";

export type PostingState = {
  status: PostingStatus;
  paidAt: Date | null;
  approvedAt: Date | null;
  /** Catégories signalées par `detectDiscriminatoryCriteria`. */
  flags: string[];
  /** Motif du dernier refus : tant qu'il est posé, pas de modération automatique. */
  reviewNote: string | null;
  publishedAt: Date | null;
  expiresAt: Date | null;
  closedAt: Date | null;
};

export type PostingEvent =
  | { type: "submit"; flags: string[] }
  | { type: "paid" }
  | { type: "approve" }
  | { type: "reject"; reason: string }
  | { type: "edit" }
  | { type: "close" }
  | { type: "expire" }
  | { type: "renew" }
  /** L'organisation change de statut (validée, suspendue) : réévaluation. */
  | { type: "orgChanged" };

export type LifecycleContext = { orgStatus: OrgStatus; now: Date; durationDays: number };

const DAY_MS = 86_400_000;
const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Modération automatique possible (rien de signalé, organisation vérifiée, jamais refusée). */
export function canAutoApprove(state: PostingState, orgStatus: OrgStatus): boolean {
  return state.flags.length === 0 && orgStatus === "ACTIVE" && state.reviewNote === null;
}

/** Statut atteint avec les conditions actuelles (paiement, modération, organisation). */
function resolve(state: PostingState, ctx: LifecycleContext): PostingState {
  if (!state.paidAt) return { ...state, status: "AWAITING_PAYMENT" };
  const approvedAt = state.approvedAt ?? (canAutoApprove(state, ctx.orgStatus) ? ctx.now : null);
  if (!approvedAt || ctx.orgStatus !== "ACTIVE") {
    return { ...state, approvedAt, status: "IN_REVIEW" };
  }
  return {
    ...state,
    approvedAt,
    status: "LIVE",
    publishedAt: ctx.now,
    expiresAt: addDays(ctx.now, ctx.durationDays),
    closedAt: null,
  };
}

/** Mise hors ligne : la période payée est consommée. */
const takeDown = (state: PostingState, now: Date, status: "CLOSED" | "REJECTED") => ({
  ...state,
  status,
  paidAt: null,
  closedAt: now,
});

export function transition(
  state: PostingState,
  event: PostingEvent,
  ctx: LifecycleContext,
): PostingState | null {
  const { status } = state;
  switch (event.type) {
    case "submit":
      if (status !== "DRAFT") return null;
      return resolve({ ...state, flags: event.flags, approvedAt: null }, ctx);

    case "paid":
      // Renouvellement d'une offre en ligne : la nouvelle période s'ajoute.
      if (status === "LIVE") {
        const from = state.expiresAt && state.expiresAt > ctx.now ? state.expiresAt : ctx.now;
        return { ...state, paidAt: ctx.now, expiresAt: addDays(from, ctx.durationDays) };
      }
      if (status === "AWAITING_PAYMENT") return resolve({ ...state, paidAt: ctx.now }, ctx);
      // Paiement arrivé après un retour au brouillon ou un refus : conservé
      // pour la prochaine soumission (jamais payé deux fois).
      if (status === "DRAFT" || status === "REJECTED" || status === "IN_REVIEW") {
        return { ...state, paidAt: state.paidAt ?? ctx.now };
      }
      return null;

    case "approve":
      if (status !== "IN_REVIEW") return null;
      return resolve({ ...state, approvedAt: ctx.now, reviewNote: null }, ctx);

    case "reject": {
      if (status === "LIVE") {
        return {
          ...takeDown(state, ctx.now, "REJECTED"),
          approvedAt: null,
          reviewNote: event.reason,
        };
      }
      if (status !== "IN_REVIEW" && status !== "AWAITING_PAYMENT") return null;
      return { ...state, status: "REJECTED", approvedAt: null, reviewNote: event.reason };
    }

    case "edit":
      if (!["DRAFT", "REJECTED", "AWAITING_PAYMENT", "CLOSED"].includes(status)) return null;
      // Contenu modifié : la modération est à refaire.
      return { ...state, status: "DRAFT", approvedAt: null };

    case "close":
      if (status !== "LIVE") return null;
      return takeDown(state, ctx.now, "CLOSED");

    case "expire":
      if (status !== "LIVE" || !state.expiresAt || state.expiresAt > ctx.now) return null;
      return takeDown(state, ctx.now, "CLOSED");

    case "renew":
      if (status !== "CLOSED") return null;
      return resolve({ ...state, paidAt: null }, ctx);

    case "orgChanged":
      if (ctx.orgStatus === "SUSPENDED" && status === "LIVE") {
        return takeDown(state, ctx.now, "CLOSED");
      }
      if (ctx.orgStatus === "ACTIVE" && status === "IN_REVIEW") {
        const next = resolve(state, ctx);
        return next.status === status ? null : next;
      }
      return null;
  }
}

/** Statut de la ligne `job_offers` : ouverte seulement en ligne ; fermée si elle l'a déjà été. */
export function offerStatusFor(state: Pick<PostingState, "status" | "publishedAt">) {
  if (state.status === "LIVE") return "OPEN" as const;
  return state.publishedAt ? ("CLOSED" as const) : ("DRAFT" as const);
}

/** Le contenu peut être modifié (formulaire d'édition). */
export const isEditable = (status: PostingStatus) =>
  status === "DRAFT" ||
  status === "REJECTED" ||
  status === "AWAITING_PAYMENT" ||
  status === "CLOSED";

/** Un paiement peut être lancé (publication ou renouvellement). */
export const canPay = (status: PostingStatus) => status === "AWAITING_PAYMENT" || status === "LIVE";
