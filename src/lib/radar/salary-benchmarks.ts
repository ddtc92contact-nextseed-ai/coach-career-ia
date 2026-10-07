import type { PrismaClient } from "@/generated/prisma/client";
import type { SeniorityCode } from "@/lib/career/codes";
import {
  annualEur,
  candidateSeniority,
  fallbackChain,
  offerArea,
  offerSeniority,
  positionAgainst,
  type BenchmarkOffer,
  type BenchmarkScope,
  type BenchmarkSeniority,
  type SalaryPosition,
} from "./benchmarks/compute";
import { BENCHMARK_CONFIG, type BenchmarkConfig } from "./benchmarks/config";
import { jobFamily, JOB_FAMILIES, type JobFamily } from "./signals/families";

/**
 * Repères de salaire du marché (Market Radar) — API de lecture.
 *
 * Point d'entrée pour la page d'une offre, les garde-fous, l'explication du
 * matching et l'agent de négociation (#31). Sans `server-only` : utilisable
 * par le worker comme par l'application, avec le client Prisma fourni.
 *
 * Les repères sont des ESTIMATIONS tirées des seules fourchettes publiées
 * dans les offres collectées (euros bruts annuels, voir
 * `./benchmarks/config.ts` pour l'annualisation et les devises). Jamais de
 * valeur inventée : sans repère publié (échantillon trop petit à tous les
 * niveaux), le résultat est `null`.
 *
 * Usage :
 * ```ts
 * const b = await getSalaryBenchmark(prisma, { family: "DATA_AI", seniority: "SENIOR",
 *   country: "FR", area: "Île-de-France" });
 * // → { p25, median, p75, sampleSize, scope: "REGION" | "COUNTRY" | "FAMILY_COUNTRY", period, … } | null
 * const o = await getOfferSalaryBenchmark(prisma, offerId);
 * // → { benchmark, offerAnnual, position: "BELOW" | "WITHIN" | "ABOVE" | null } | null
 * ```
 */

export type SalaryBenchmark = {
  p25: number;
  median: number;
  p75: number;
  sampleSize: number;
  /** Niveau effectivement utilisé (repli vers plus large si le plus précis manque de données). */
  scope: BenchmarkScope;
  /** Vrai si un niveau plus précis était demandé mais n'avait pas assez de données. */
  fallback: boolean;
  /** Dates de publication des offres utilisées. */
  period: { from: Date; to: Date };
  family: JobFamily;
  /** `ALL` au niveau `FAMILY_COUNTRY`. */
  seniority: string;
  country: string;
  /** Région française ou `REMOTE` au niveau `REGION`, sinon `null`. */
  area: string | null;
};

export type BenchmarkQuery = {
  family: JobFamily;
  seniority?: BenchmarkSeniority | null;
  /** Code pays ISO 3166-1 alpha-2. */
  country: string;
  /** Région française officielle (« Île-de-France ») ou `REMOTE`. */
  area?: string | null;
};

/**
 * Repère le plus précis publié pour (famille, séniorité, zone), en se
 * rabattant sur famille × séniorité × pays puis famille × pays. `null` si
 * aucun niveau n'a assez de données.
 */
export async function getSalaryBenchmark(
  prisma: PrismaClient,
  query: BenchmarkQuery,
  config: Pick<BenchmarkConfig, "minSample"> = BENCHMARK_CONFIG,
): Promise<SalaryBenchmark | null> {
  if (!(JOB_FAMILIES as readonly string[]).includes(query.family)) return null;
  const chain = fallbackChain({
    family: query.family,
    seniority: query.seniority ?? null,
    country: query.country.toUpperCase(),
    area: query.area ?? null,
  });
  const rows = await prisma.salaryBenchmark.findMany({
    // Le seuil est revérifié à la lecture : un seuil relevé prend effet sans attendre le job.
    where: { key: { in: chain.map((c) => c.key) }, sampleSize: { gte: config.minSample } },
  });
  for (const [index, { key }] of chain.entries()) {
    const row = rows.find((r) => r.key === key);
    if (row) {
      return {
        fallback: index > 0,
        p25: row.p25,
        median: row.median,
        p75: row.p75,
        sampleSize: row.sampleSize,
        scope: row.scope,
        period: { from: row.periodStart, to: row.periodEnd },
        family: row.family as JobFamily,
        seniority: row.seniority,
        country: row.country,
        area: row.area,
      };
    }
  }
  return null;
}

export type OfferBenchmark = {
  benchmark: SalaryBenchmark | null;
  /** Salaire annuel brut en euros de l'offre (point médian), `null` s'il n'est pas annoncé. */
  offerAnnual: number | null;
  /** Position de l'offre face au repère, `null` sans salaire annoncé ou sans repère. */
  position: SalaryPosition | null;
};

type OfferForBenchmark = Pick<
  BenchmarkOffer,
  | "title"
  | "seniority"
  | "country"
  | "region"
  | "remotePolicy"
  | "salaryMin"
  | "salaryMax"
  | "salaryCurrency"
  | "salaryPeriod"
>;

/**
 * Repère applicable à une offre déjà chargée. `null` si l'offre n'a ni
 * famille de métiers reconnue ni pays connu (aucun repère possible).
 */
export async function benchmarkForOffer(
  prisma: PrismaClient,
  offer: OfferForBenchmark,
  config: BenchmarkConfig = BENCHMARK_CONFIG,
): Promise<OfferBenchmark | null> {
  const family = jobFamily(offer.title);
  if (!family || !offer.country) return null;
  const benchmark = await getSalaryBenchmark(
    prisma,
    {
      family,
      seniority: offerSeniority(offer.title, offer.seniority),
      country: offer.country,
      area: offerArea(offer),
    },
    config,
  );
  const offerAnnual = annualEur(offer, config);
  return {
    benchmark,
    offerAnnual: offerAnnual === null ? null : Math.round(offerAnnual),
    position: benchmark && offerAnnual !== null ? positionAgainst(offerAnnual, benchmark) : null,
  };
}

/** Repère applicable à une offre, par identifiant (`null` : offre inconnue ou non classable). */
export async function getOfferSalaryBenchmark(
  prisma: PrismaClient,
  offerId: string,
  config: BenchmarkConfig = BENCHMARK_CONFIG,
): Promise<OfferBenchmark | null> {
  const offer = await prisma.jobOffer.findUnique({
    where: { id: offerId },
    select: {
      title: true,
      seniority: true,
      country: true,
      region: true,
      remotePolicy: true,
      salaryMin: true,
      salaryMax: true,
      salaryCurrency: true,
      salaryPeriod: true,
    },
  });
  if (!offer) return null;
  return benchmarkForOffer(
    prisma,
    {
      ...offer,
      salaryMin: offer.salaryMin === null ? null : Number(offer.salaryMin.toString()),
      salaryMax: offer.salaryMax === null ? null : Number(offer.salaryMax.toString()),
    },
    config,
  );
}

export type CandidateBenchmark = {
  family: JobFamily;
  seniority: BenchmarkSeniority | null;
  benchmark: SalaryBenchmark | null;
};

/**
 * Repère pour la famille visée par un candidat, déduite de l'intitulé de son
 * poste le plus récent (France, toutes régions). `null` si la famille est
 * inconnue (pas d'expérience, intitulé non reconnu).
 */
export async function getCandidateSalaryBenchmark(
  prisma: PrismaClient,
  userId: string,
  config: Pick<BenchmarkConfig, "minSample"> = BENCHMARK_CONFIG,
): Promise<CandidateBenchmark | null> {
  const latest = await prisma.experience.findFirst({
    where: { userId },
    orderBy: [{ endMonth: { sort: "desc", nulls: "first" } }, { startMonth: "desc" }],
    select: { roleTitle: true, seniority: true },
  });
  const family = latest ? jobFamily(latest.roleTitle) : null;
  if (!latest || !family) return null;
  const seniority = candidateSeniority(latest.seniority as SeniorityCode);
  const benchmark = await getSalaryBenchmark(prisma, { family, seniority, country: "FR" }, config);
  return { family, seniority, benchmark };
}

export type { BenchmarkScope, SalaryPosition } from "./benchmarks/compute";
