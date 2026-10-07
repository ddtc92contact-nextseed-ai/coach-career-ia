import type { BenchmarkScope } from "@/lib/radar/benchmarks/compute";

/**
 * Repère de salaire du marché (Market Radar, #35) au service de la
 * négociation : conseils au moment du mandat et chiffres que l'agent peut
 * citer, sans bluff.
 *
 * Le repère vient UNIQUEMENT des fourchettes publiées dans les offres
 * collectées (famille × séniorité × zone de l'offre négociée), jamais des
 * données du candidat. Il est toujours présenté comme « des offres publiées »,
 * jamais comme une offre reçue par le candidat (voir `checkOutgoing`).
 *
 * Module pur, partagé par le serveur, le formulaire et les tests.
 */

/** Repère transmis à l'agent : chiffres publiés et périmètre, rien d'autre. */
export type MarketBenchmark = {
  p25: number;
  median: number;
  p75: number;
  sampleSize: number;
  scope: BenchmarkScope;
  /** Région française ou `REMOTE` au niveau `REGION`, sinon `null`. */
  area: string | null;
};

/**
 * Repère utilisable dans la négociation, ou `null` sous le seuil
 * d'échantillon (`BENCHMARK_CONFIG.minSample`) : sans assez d'offres, aucun
 * chiffre n'est affiché ni transmis au modèle.
 */
export function marketForNegotiation<
  T extends { p25: number; median: number; p75: number; sampleSize: number },
>(benchmark: T | null | undefined, minSample: number): T | null {
  if (!benchmark || benchmark.sampleSize < minSample) return null;
  const values = [benchmark.p25, benchmark.median, benchmark.p75];
  if (!values.every((v) => Number.isFinite(v) && v > 0)) return null;
  return benchmark;
}

/** Chiffres du repère, arrondis à l'euro (ceux que l'agent peut citer). */
export function marketFigures(market: MarketBenchmark | null): number[] {
  return market ? [market.p25, market.median, market.p75].map(Math.round) : [];
}

export const MANDATE_HINTS = ["targetBelowMarket", "targetAboveMarket", "floorAboveOffer"] as const;
export type MandateHint = (typeof MANDATE_HINTS)[number];

/**
 * Conseils (non bloquants) sur le mandat : cible sous le 1er quartile ou
 * au-dessus du 3e, plancher au-dessus du maximum annoncé par l'offre (annuel
 * brut en euros, `null` s'il n'est pas annoncé ou pas comparable).
 */
export function mandateHints(
  mandate: { salaryFloor?: number | null; salaryTarget?: number | null },
  market: { p25: number; p75: number } | null,
  offerMaxAnnual: number | null,
): MandateHint[] {
  const hints: MandateHint[] = [];
  const target = mandate.salaryTarget ?? null;
  const floor = mandate.salaryFloor ?? null;
  if (market && target !== null) {
    if (target < market.p25) hints.push("targetBelowMarket");
    else if (target > market.p75) hints.push("targetAboveMarket");
  }
  if (floor !== null && offerMaxAnnual !== null && floor > offerMaxAnnual) {
    hints.push("floorAboveOffer");
  }
  return hints;
}
