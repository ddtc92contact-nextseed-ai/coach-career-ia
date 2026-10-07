import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import type { OrganizationStatus } from "@/generated/prisma/enums";
import type { OneTimePayment } from "@/lib/billing/webhook";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { markAllCandidatesDirty } from "@/lib/matching/jobs";
import { postingDurationDays } from "./config";
import {
  offerStatusFor,
  transition,
  type PostingEvent,
  type PostingState,
  type PostingStatus,
} from "./lifecycle";

/**
 * Application des transitions du cycle de vie en base : l'offre directe
 * (`job_postings`) et sa ligne `job_offers` changent ENSEMBLE. Sans
 * `server-only` : utilisé par l'application, le traitement des paiements et
 * le worker (expiration), avec le client Prisma ou la transaction fournis.
 *
 * Une offre qui entre en ligne ou en sort déclenche le recalcul des
 * opportunités de tous les candidats : elle passe par le même matching que
 * les offres du radar (garde-fous durs, embeddings, score).
 */

type Db = PrismaClient | Prisma.TransactionClient;

const postingSelect = {
  id: true,
  orgId: true,
  offerId: true,
  status: true,
  paidAt: true,
  approvedAt: true,
  flags: true,
  reviewNote: true,
  publishedAt: true,
  expiresAt: true,
  closedAt: true,
  organization: { select: { status: true } },
} as const;

export type TransitionOutcome = {
  postingId: string;
  orgId: string;
  from: PostingStatus;
  to: PostingStatus;
};

/**
 * Applique un évènement à une offre directe. `null` si l'offre n'existe pas
 * ou si l'évènement n'a pas de sens dans son état (rien n'est écrit).
 * La mise à jour est conditionnelle (statut et date de modification lus) :
 * deux requêtes simultanées ne rejouent pas la même transition.
 */
export async function applyPostingEvent(
  tx: Db,
  postingId: string,
  event: PostingEvent,
  options: { now?: Date; durationDays?: number } = {},
): Promise<TransitionOutcome | null> {
  const now = options.now ?? new Date();
  const posting = await tx.jobPosting.findUnique({
    where: { id: postingId },
    select: { ...postingSelect, updatedAt: true },
  });
  if (!posting) return null;
  const state: PostingState = {
    status: posting.status,
    paidAt: posting.paidAt,
    approvedAt: posting.approvedAt,
    flags: posting.flags,
    reviewNote: posting.reviewNote,
    publishedAt: posting.publishedAt,
    expiresAt: posting.expiresAt,
    closedAt: posting.closedAt,
  };
  const next = transition(state, event, {
    orgStatus: posting.organization.status,
    now,
    durationDays: options.durationDays ?? postingDurationDays(),
  });
  if (!next) return null;

  const { count } = await tx.jobPosting.updateMany({
    where: { id: posting.id, status: posting.status, updatedAt: posting.updatedAt },
    data: {
      status: next.status,
      paidAt: next.paidAt,
      approvedAt: next.approvedAt,
      flags: next.flags,
      reviewNote: next.reviewNote,
      publishedAt: next.publishedAt,
      expiresAt: next.expiresAt,
      closedAt: next.closedAt,
    },
  });
  if (count === 0) return null;

  const offerBefore = offerStatusFor(state);
  const offerAfter = offerStatusFor(next);
  const wentLive = next.status === "LIVE" && posting.status !== "LIVE";
  await tx.jobOffer.update({
    where: { id: posting.offerId },
    data: {
      status: offerAfter,
      closedAt: offerAfter === "CLOSED" ? (next.closedAt ?? now) : null,
      ...(wentLive
        ? {
            publishedAt: now,
            lastSeenAt: now,
            // Première mise en ligne : date d'apparition sur le marché.
            ...(posting.publishedAt ? {} : { firstSeenAt: now }),
            // Remise en ligne après une fermeture.
            ...(offerBefore === "CLOSED" ? { reopenedAt: now, reopenCount: { increment: 1 } } : {}),
          }
        : {}),
      ...(next.status === "LIVE" ? { lastSeenAt: now } : {}),
    },
  });
  // Offre entrée en ligne ou retirée : opportunités des candidats à recalculer.
  if ((offerBefore === "OPEN") !== (offerAfter === "OPEN")) {
    await markAllCandidatesDirty(tx as PrismaClient, now);
  }
  return { postingId: posting.id, orgId: posting.orgId, from: posting.status, to: next.status };
}

/**
 * Paiement unitaire confirmé (webhook Stripe ou simulateur) : l'achat est
 * marqué payé puis l'offre avance (publication, ou prolongation si elle est
 * déjà en ligne). `unmatched` si l'achat est inconnu, déjà traité, ou si le
 * montant payé ne correspond pas à celui attendu.
 */
export async function applyJobPostingPayment(
  tx: Db,
  payment: OneTimePayment,
  options: { now?: Date; logger?: Logger } = {},
): Promise<"applied" | "unmatched"> {
  const log = options.logger ?? defaultLogger;
  const now = options.now ?? new Date();
  const row = await tx.jobPostingPayment.findUnique({
    where: { id: payment.paymentId },
    select: {
      id: true,
      postingId: true,
      checkoutSessionId: true,
      amountCents: true,
      currency: true,
      status: true,
    },
  });
  if (!row || row.checkoutSessionId !== payment.checkoutSessionId || row.status !== "PENDING") {
    return "unmatched";
  }
  if (
    (payment.amountCents !== null && payment.amountCents !== row.amountCents) ||
    (payment.currency !== null && payment.currency !== row.currency)
  ) {
    log.warn("employer.payment.amountMismatch", { paymentId: row.id });
    return "unmatched";
  }
  const { count } = await tx.jobPostingPayment.updateMany({
    where: { id: row.id, status: "PENDING" },
    data: { status: "PAID", paidAt: now },
  });
  if (count === 0) return "unmatched";
  const outcome = await applyPostingEvent(tx, row.postingId, { type: "paid" }, { now });
  log.info("employer.posting.paid", {
    postingId: row.postingId,
    from: outcome?.from,
    to: outcome?.to,
  });
  return "applied";
}

/**
 * Nouveau statut d'une organisation (validation, refus, suspension) : ses
 * offres sont réévaluées — publiées si elles n'attendaient que la
 * validation, fermées si l'organisation est suspendue.
 */
export async function setOrganizationStatus(
  tx: Db,
  orgId: string,
  status: OrganizationStatus,
  options: { note?: string | null; now?: Date } = {},
): Promise<TransitionOutcome[]> {
  const now = options.now ?? new Date();
  await tx.organization.update({
    where: { id: orgId },
    data: {
      status,
      reviewNote: options.note ?? null,
      ...(status === "ACTIVE" ? { verifiedAt: now } : {}),
    },
  });
  const postings = await tx.jobPosting.findMany({
    where: { orgId, status: { in: ["LIVE", "IN_REVIEW"] } },
    select: { id: true },
  });
  const outcomes: TransitionOutcome[] = [];
  for (const { id } of postings) {
    const outcome = await applyPostingEvent(tx, id, { type: "orgChanged" }, { now });
    if (outcome) outcomes.push(outcome);
  }
  return outcomes;
}

/**
 * Expiration : les offres en ligne arrivées à échéance sont fermées (statut
 * `CLOSED` de `job_offers`). Exécuté par le worker et à l'affichage du
 * tableau de bord. Renvoie le nombre d'offres fermées.
 */
export async function expireDirectPostings(
  prisma: PrismaClient,
  options: { now?: Date; logger?: Logger; orgId?: string } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const due = await prisma.jobPosting.findMany({
    where: {
      status: "LIVE",
      expiresAt: { lte: now },
      ...(options.orgId ? { orgId: options.orgId } : {}),
    },
    select: { id: true },
    take: 500,
  });
  let closed = 0;
  for (const { id } of due) {
    const outcome = await prisma.$transaction((tx) =>
      applyPostingEvent(tx, id, { type: "expire" }, { now }),
    );
    if (outcome) closed++;
  }
  if (closed > 0) (options.logger ?? defaultLogger).info("employer.postings.expired", { closed });
  return closed;
}
