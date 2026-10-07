import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import type { AlertFrequency, MatchStatus } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { NotFoundError } from "@/lib/career/repository";
import { loadCandidate, loadRails, matchOfferSelect, toMatchOffer } from "./candidate";
import { parseExplanation } from "./explanation";
import { checkGuardRails } from "./filters";
import type { CandidateRails } from "./types";
import { DIRECT_SOURCE } from "@/lib/employer/config";

/**
 * Accès aux correspondances depuis l'application. Toutes les requêtes sont
 * filtrées par l'utilisateur courant : la correspondance d'un autre
 * utilisateur est traitée comme inexistante (404).
 *
 * Les garde-fous sont REVÉRIFIÉS à l'affichage (filtres purs, sans IA ni
 * recalcul de score) : entre une modification des garde-fous et le recalcul
 * du worker, aucune offre qui les viole ne peut apparaître.
 */

export const STATUS_FILTERS = ["active", "saved", "dismissed", "all"] as const;
export type StatusFilter = (typeof STATUS_FILTERS)[number];
export const SCORE_FILTERS = [0, 50, 70, 85] as const;

const STATUSES: Record<StatusFilter, MatchStatus[]> = {
  active: ["NEW", "SEEN"],
  saved: ["SAVED"],
  dismissed: ["DISMISSED"],
  all: ["NEW", "SEEN", "SAVED"],
};

const PAGE_SIZE = 100;

const matchSelect = {
  id: true,
  score: true,
  status: true,
  explanation: true,
  computedAt: true,
  offer: {
    select: {
      ...matchOfferSelect,
      source: true,
      companyId: true,
      url: true,
      city: true,
      region: true,
      country: true,
      publishedAt: true,
    },
  },
} satisfies Prisma.MatchSelect;

type MatchRow = Prisma.MatchGetPayload<{ select: typeof matchSelect }>;

function present(row: MatchRow) {
  const offer = toMatchOffer(row.offer);
  return {
    id: row.id,
    score: row.score,
    status: row.status,
    computedAt: row.computedAt,
    explanation: parseExplanation(row.explanation),
    offer: {
      ...offer,
      companyId: row.offer.companyId,
      /** Publiée directement par l'entreprise (espace entreprise), pas collectée. */
      direct: row.offer.source === DIRECT_SOURCE,
      url: row.offer.url,
      city: row.offer.city,
      region: row.offer.region,
      country: row.offer.country,
      publishedAt: row.offer.publishedAt,
    },
  };
}
export type MatchView = ReturnType<typeof present>;

const visible = (rails: CandidateRails) => (row: MatchRow) =>
  checkGuardRails(toMatchOffer(row.offer), rails).pass;

export type Opportunities = {
  /** Pourquoi la liste est vide d'office (mémoire ou garde-fous manquants). */
  blocker: "noMemory" | "noGuardRails" | null;
  /** Un recalcul est en attente (changement récent). */
  pending: boolean;
  computedAt: Date | null;
  items: MatchView[];
};

export async function getOpportunities(
  userId: string,
  filter: { status: StatusFilter; minScore: number },
): Promise<Opportunities> {
  const [candidate, state] = await Promise.all([
    loadCandidate(db, userId),
    db.matchingState.findUnique({ where: { userId }, select: { dirtyAt: true, computedAt: true } }),
  ]);
  const base = { pending: Boolean(state?.dirtyAt), computedAt: state?.computedAt ?? null };
  if (!candidate.eligible) return { ...base, blocker: candidate.reason, items: [] };

  const rows = await db.match.findMany({
    where: {
      userId,
      status: { in: STATUSES[filter.status] },
      score: { gte: filter.minScore },
      offer: { status: "OPEN", duplicateOfId: null },
    },
    orderBy: [{ score: "desc" }, { computedAt: "desc" }],
    take: PAGE_SIZE,
    select: matchSelect,
  });
  return {
    ...base,
    blocker: null,
    items: rows.filter(visible(candidate.candidate.rails)).map(present),
  };
}

/** Une correspondance du candidat, ou `null` (autre utilisateur, offre fermée, hors garde-fous). */
export async function getMatch(userId: string, id: string): Promise<MatchView | null> {
  const [row, rails] = await Promise.all([
    db.match.findFirst({
      where: { id, userId, offer: { status: "OPEN", duplicateOfId: null } },
      select: matchSelect,
    }),
    loadRails(db, userId),
  ]);
  if (!row || !rails || !visible(rails)(row)) return null;
  return present(row);
}

/** Première consultation : `NEW` → `SEEN`. */
export async function markMatchSeen(userId: string, id: string) {
  if (typeof id !== "string") return;
  const { count } = await db.match.updateMany({
    where: { id, userId, status: "NEW" },
    data: { status: "SEEN" },
  });
  // Offre directe : un candidat de plus l'a consultée (compteur seul, aucune identité).
  if (count > 0) {
    await db.jobPosting.updateMany({
      where: { offer: { source: DIRECT_SOURCE, matches: { some: { id, userId } } } },
      data: { viewCount: { increment: 1 } },
    });
  }
}

export async function setMatchStatus(
  userId: string,
  id: string,
  status: Extract<MatchStatus, "SEEN" | "SAVED" | "DISMISSED">,
) {
  // Un objet (`{ not: "x" }`) deviendrait un filtre Prisma sur toutes les lignes.
  if (typeof id !== "string") throw new NotFoundError();
  const { count } = await db.match.updateMany({ where: { id, userId }, data: { status } });
  if (count === 0) throw new NotFoundError();
}

export async function getAlertSettings(userId: string) {
  const state = await db.matchingState.findUnique({
    where: { userId },
    select: { alertFrequency: true, alertMinScore: true },
  });
  return { frequency: state?.alertFrequency ?? "OFF", minScore: state?.alertMinScore ?? 70 };
}

export async function saveAlertSettings(
  userId: string,
  settings: { frequency: AlertFrequency; minScore: number },
) {
  const data = { alertFrequency: settings.frequency, alertMinScore: settings.minScore };
  await db.matchingState.upsert({ where: { userId }, create: { userId, ...data }, update: data });
}
