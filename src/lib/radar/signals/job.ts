import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { SIGNAL_THRESHOLDS, type SignalThresholds } from "./config";
import {
  addWeeks,
  completedWeeks,
  detectSignals,
  weekStats,
  type DetectedSignal,
  type HistoryOffer,
} from "./compute";

/**
 * Job des signaux faibles (même worker que le radar) : pour chaque entreprise
 * suivie, recalcule les `lookbackWeeks` dernières semaines terminées
 * (statistiques + signaux) à partir des offres collectées.
 *
 * Idempotent : statistiques et signaux sont upsertés sur (entreprise,
 * semaine[, type]) et un signal qui ne tient plus pour une semaine recalculée
 * est supprimé. Une entreprise en erreur n'empêche pas les autres.
 */

export type SignalsDeps = {
  now?: () => Date;
  logger?: Logger;
  thresholds?: SignalThresholds;
};

export type SignalsSummary = {
  companies: number;
  weeks: number;
  signals: number;
  failed: number;
};

const historySelect = {
  id: true,
  title: true,
  seniority: true,
  dedupKey: true,
  city: true,
  country: true,
  remotePolicy: true,
  salaryMin: true,
  salaryMax: true,
  firstSeenAt: true,
  closedAt: true,
  reopenedAt: true,
  reopenCount: true,
  duplicateOfId: true,
} satisfies Prisma.JobOfferSelect;

export async function loadCompanyHistory(
  prisma: PrismaClient,
  companyId: string,
): Promise<HistoryOffer[]> {
  const rows = await prisma.jobOffer.findMany({
    // Les doublons d'une autre source ne sont jamais comptés deux fois.
    where: { companyId, duplicateOfId: null },
    select: historySelect,
  });
  return rows.map(({ salaryMin, salaryMax, ...row }) => ({
    ...row,
    hasSalary: salaryMin !== null || salaryMax !== null,
  }));
}

async function computeCompany(
  prisma: PrismaClient,
  companyId: string,
  weeks: Date[],
  now: Date,
  thresholds: SignalThresholds,
): Promise<number> {
  const offers = await loadCompanyHistory(prisma, companyId);
  if (offers.length === 0) return 0;
  const firstSeen = Math.min(...offers.map((o) => o.firstSeenAt.getTime()));
  const observed = weeks.filter((w) => addWeeks(w, 1).getTime() > firstSeen);

  const stats = observed.map((w) => weekStats(offers, w, thresholds));
  const signals: DetectedSignal[] = observed.flatMap((w) => detectSignals(offers, w, thresholds));
  const range = { gte: weeks[0]!, lt: addWeeks(weeks.at(-1)!, 1) };

  await prisma.$transaction([
    ...stats.map((s) => {
      const data = {
        newOffers: s.newOffers,
        closedOffers: s.closedOffers,
        openCount: s.openCount,
        medianDaysToClose: s.medianDaysToClose,
        salaryShare: s.salaryShare,
        remoteShare: s.remoteShare,
        newCities: s.newCities,
        newCountries: s.newCountries,
        newFamilies: s.newFamilies,
        firstLeadership: s.firstLeadership,
        computedAt: now,
      };
      return prisma.companyWeekStat.upsert({
        where: { companyId_weekStart: { companyId, weekStart: s.weekStart } },
        create: { companyId, weekStart: s.weekStart, ...data },
        update: data,
      });
    }),
    // Signaux qui ne tiennent plus (offres corrigées, seuils ajustés).
    prisma.companySignal.deleteMany({
      where: {
        companyId,
        periodStart: range,
        NOT: signals.map((s) => ({ type: s.type, periodStart: s.periodStart })),
      },
    }),
    ...signals.map((s) => {
      const data = {
        strength: s.strength,
        periodEnd: s.periodEnd,
        facts: s.facts as Prisma.InputJsonObject,
      };
      return prisma.companySignal.upsert({
        where: {
          companyId_type_periodStart: { companyId, type: s.type, periodStart: s.periodStart },
        },
        create: { companyId, type: s.type, periodStart: s.periodStart, detectedAt: now, ...data },
        update: data,
      });
    }),
  ]);
  return signals.length;
}

export async function runCompanySignals(
  prisma: PrismaClient,
  deps: SignalsDeps = {},
): Promise<SignalsSummary> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const thresholds = deps.thresholds ?? SIGNAL_THRESHOLDS;
  const weeks = completedWeeks(now, thresholds.lookbackWeeks);

  const companies = await prisma.company.findMany({
    where: { offers: { some: {} } },
    select: { id: true, slug: true },
    orderBy: { slug: "asc" },
  });
  const summary: SignalsSummary = { companies: 0, weeks: weeks.length, signals: 0, failed: 0 };
  for (const company of companies) {
    try {
      summary.signals += await computeCompany(prisma, company.id, weeks, now, thresholds);
      summary.companies++;
    } catch (error) {
      summary.failed++;
      log.error("radar.signals.company_failed", {
        company: company.slug,
        error: error instanceof Error ? error.name : "erreur",
      });
    }
  }
  log.info("radar.signals.finished", { ...summary });
  return summary;
}
