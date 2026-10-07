import type { BenchmarkOffer } from "@/lib/radar/benchmarks/compute";

/**
 * Offres enregistrées pour les tests des repères de salaire : fourchettes
 * telles que publiées par les sources (annuel, mensuel, journalier, horaire,
 * autres devises), doublons, offres sans salaire et valeurs aberrantes.
 */
export const COLLECTED_AT = new Date("2026-09-15T00:00:00.000Z");

let sequence = 0;

export function salaryOffer(spec: Partial<BenchmarkOffer> = {}): BenchmarkOffer {
  const id = spec.id ?? `s${++sequence}`;
  return {
    id,
    title: "Data Engineer Senior",
    seniority: null,
    country: "FR",
    region: "Île-de-France",
    remotePolicy: "HYBRID",
    contractType: "CDI",
    salaryMin: 55_000,
    salaryMax: 65_000,
    salaryCurrency: "EUR",
    salaryPeriod: "YEAR",
    publishedAt: null,
    firstSeenAt: COLLECTED_AT,
    duplicateOfId: null,
    ...spec,
  };
}

/** `count` offres « Data Engineer Senior » d'une zone, salaires médians de `from` à `from + (count-1) × step`. */
export function series(
  count: number,
  from: number,
  step: number,
  spec: Partial<BenchmarkOffer> = {},
): BenchmarkOffer[] {
  return Array.from({ length: count }, (_, i) => {
    const mid = from + i * step;
    return salaryOffer({
      salaryMin: mid - 5_000,
      salaryMax: mid + 5_000,
      firstSeenAt: new Date(COLLECTED_AT.getTime() - i * 86_400_000),
      ...spec,
    });
  });
}
