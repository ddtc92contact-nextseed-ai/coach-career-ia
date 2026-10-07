import type { PrismaClient } from "@/generated/prisma/client";
import type { CompanySignalType } from "@/generated/prisma/enums";
import { SIGNAL_THRESHOLDS } from "./config";
import { addWeeks, mostRelevant, weekStart, type SignalFacts } from "./compute";

/** Signal tel que lu par l'application, le matching ou le coach. */
export type CompanySignalView = {
  id: string;
  companyId: string;
  type: CompanySignalType;
  /** 1 (faible) à 3 (fort). */
  strength: number;
  periodStart: Date;
  periodEnd: Date;
  facts: SignalFacts;
};

export type SignalQuery = {
  /** Semaines récentes prises en compte (défaut : `display.recentWeeks`). */
  sinceWeeks?: number;
  /** Nombre maximal de signaux, du plus pertinent au moins pertinent. */
  limit?: number;
  now?: Date;
};

const select = {
  id: true,
  companyId: true,
  type: true,
  strength: true,
  periodStart: true,
  periodEnd: true,
  facts: true,
} as const;

function toView(row: {
  id: string;
  companyId: string;
  type: CompanySignalType;
  strength: number;
  periodStart: Date;
  periodEnd: Date;
  facts: unknown;
}): CompanySignalView {
  return { ...row, facts: row.facts as SignalFacts };
}

/**
 * Signaux récents d'une entreprise, du plus pertinent au moins pertinent (le
 * plus récent de chaque type). Utilisable hors de Next.js (worker, scripts).
 */
export async function loadCompanySignals(
  prisma: PrismaClient,
  companyId: string,
  query: SignalQuery = {},
): Promise<CompanySignalView[]> {
  const since = addWeeks(
    weekStart(query.now ?? new Date()),
    -(query.sinceWeeks ?? SIGNAL_THRESHOLDS.display.recentWeeks),
  );
  const rows = await prisma.companySignal.findMany({
    where: { companyId, periodStart: { gte: since } },
    select,
  });
  return mostRelevant(rows.map(toView), query.limit ?? rows.length);
}

/** Entreprises suivies avec leurs derniers chiffres et signaux (page admin du radar). */
export async function loadCompanyMomentum(
  prisma: PrismaClient,
  query: { sinceWeeks?: number; signalsPerCompany?: number; now?: Date } = {},
) {
  const since = addWeeks(
    weekStart(query.now ?? new Date()),
    -(query.sinceWeeks ?? SIGNAL_THRESHOLDS.display.recentWeeks),
  );
  const companies = await prisma.company.findMany({
    where: { offers: { some: {} } },
    select: {
      id: true,
      name: true,
      weekStats: { orderBy: { weekStart: "desc" }, take: 1 },
      signals: { where: { periodStart: { gte: since } }, select },
      _count: { select: { offers: { where: { status: "OPEN", duplicateOfId: null } } } },
    },
    orderBy: { name: "asc" },
  });
  return companies
    .map((c) => ({
      id: c.id,
      name: c.name,
      openOffers: c._count.offers,
      lastWeek: c.weekStats[0] ?? null,
      signals: mostRelevant(c.signals.map(toView), query.signalsPerCompany ?? 3),
    }))
    .sort(
      (a, b) =>
        b.signals.length - a.signals.length ||
        b.openOffers - a.openOffers ||
        a.name.localeCompare(b.name),
    );
}
export type CompanyMomentum = Awaited<ReturnType<typeof loadCompanyMomentum>>[number];
