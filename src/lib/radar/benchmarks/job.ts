import type { PrismaClient } from "@/generated/prisma/client";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import {
  collectSamples,
  computeBenchmarks,
  type BenchmarkOffer,
  type ComputedBenchmark,
} from "./compute";
import { BENCHMARK_CONFIG, type BenchmarkConfig } from "./config";

/**
 * Job des repères de salaire (même worker et même rythme que les signaux
 * faibles) : relit les offres à salaire annoncé des `lookbackDays` derniers
 * jours, recalcule tous les repères et remplace ceux en base.
 *
 * Idempotent : chaque repère est upserté sur sa clé, et un repère qui n'est
 * plus publiable (échantillon passé sous le seuil, famille disparue) est
 * supprimé. Un repère en erreur n'empêche pas les autres. Seuls des comptes
 * sont journalisés (aucune offre, aucun montant).
 */

export type BenchmarksDeps = {
  now?: () => Date;
  logger?: Logger;
  config?: BenchmarkConfig;
};

export type BenchmarksSummary = {
  offers: number;
  samples: number;
  duplicates: number;
  excludedContracts: number;
  outliers: number;
  published: number;
  belowThreshold: number;
  removed: number;
  failed: number;
};

const DAY_MS = 86_400_000;

export async function loadBenchmarkOffers(
  prisma: PrismaClient,
  since: Date,
): Promise<BenchmarkOffer[]> {
  const rows = await prisma.jobOffer.findMany({
    where: {
      // Les doublons sont écartés à la source, et recomptés par le calcul s'il en reste.
      duplicateOfId: null,
      OR: [{ salaryMin: { not: null } }, { salaryMax: { not: null } }],
      firstSeenAt: { gte: since },
    },
    select: {
      id: true,
      title: true,
      seniority: true,
      country: true,
      region: true,
      remotePolicy: true,
      contractType: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
      publishedAt: true,
      firstSeenAt: true,
      duplicateOfId: true,
    },
  });
  return rows.map((row) => ({
    ...row,
    salaryMin: row.salaryMin === null ? null : Number(row.salaryMin.toString()),
    salaryMax: row.salaryMax === null ? null : Number(row.salaryMax.toString()),
  }));
}

async function saveBenchmark(prisma: PrismaClient, b: ComputedBenchmark, now: Date) {
  const data = {
    scope: b.scope,
    family: b.family,
    seniority: b.seniority,
    country: b.country,
    area: b.area,
    sampleSize: b.sampleSize,
    p25: b.p25,
    median: b.median,
    p75: b.p75,
    periodStart: b.periodStart,
    periodEnd: b.periodEnd,
    computedAt: now,
  };
  await prisma.salaryBenchmark.upsert({
    where: { key: b.key },
    create: { key: b.key, ...data },
    update: data,
  });
}

export async function runSalaryBenchmarks(
  prisma: PrismaClient,
  deps: BenchmarksDeps = {},
): Promise<BenchmarksSummary> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const config = deps.config ?? BENCHMARK_CONFIG;

  const offers = await loadBenchmarkOffers(
    prisma,
    new Date(now.getTime() - config.lookbackDays * DAY_MS),
  );
  const stats = collectSamples(offers, config);
  const { published, belowThreshold } = computeBenchmarks(stats.samples, config);

  const summary: BenchmarksSummary = {
    offers: stats.offers,
    samples: stats.samples.length,
    duplicates: stats.duplicates,
    excludedContracts: stats.excludedContracts,
    outliers: stats.outliers,
    published: 0,
    belowThreshold,
    removed: 0,
    failed: 0,
  };
  const kept: string[] = [];
  for (const benchmark of published) {
    try {
      await saveBenchmark(prisma, benchmark, now);
      summary.published++;
      kept.push(benchmark.key);
    } catch (error) {
      summary.failed++;
      // Le repère précédent (s'il existe) est conservé plutôt que supprimé.
      kept.push(benchmark.key);
      log.error("radar.benchmarks.bucket_failed", {
        bucket: benchmark.key,
        error: error instanceof Error ? error.name : "erreur",
      });
    }
  }
  const { count } = await prisma.salaryBenchmark.deleteMany({ where: { key: { notIn: kept } } });
  summary.removed = count;
  log.info("radar.benchmarks.finished", { ...summary });
  return summary;
}
