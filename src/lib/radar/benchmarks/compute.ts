import type { ContractType, RemotePolicy, SalaryPeriod } from "@/generated/prisma/enums";
import type { SeniorityCode } from "@/lib/career/codes";
import { offerSeniorityRank, SENIORITY_RANK } from "@/lib/matching/signals";
import { REGION_DEPARTMENTS } from "@/lib/radar/normalize";
import { jobFamily, type JobFamily } from "@/lib/radar/signals/families";
import { BENCHMARK_CONFIG, type BenchmarkConfig } from "./config";

/**
 * Repères de salaire du marché, calculés uniquement à partir des fourchettes
 * publiées dans les offres collectées (fonctions pures, sans base ni réseau).
 *
 * Un repère = famille de métiers × séniorité × zone, en euros bruts annuels :
 * p25 / médiane / p75 du point médian de chaque fourchette. Trois niveaux,
 * du plus précis au plus large :
 * - `REGION` : famille × séniorité × pays × zone (région française, ou
 *   `REMOTE` pour les offres en télétravail complet) ;
 * - `COUNTRY` : famille × séniorité × pays ;
 * - `FAMILY_COUNTRY` : famille × pays, toutes séniorités.
 * Un repère sous `minSample` offres n'est pas publié ; la lecture se rabat
 * alors sur le niveau plus large (`../salary-benchmarks.ts`).
 *
 * Exclus : doublons inter-sources (`duplicateOfId`), offres sans salaire,
 * sans famille reconnue ou sans pays, devises hors table, contrats exclus
 * et valeurs hors de la plage plausible.
 */

export const BENCHMARK_SCOPES = ["REGION", "COUNTRY", "FAMILY_COUNTRY"] as const;
export type BenchmarkScope = (typeof BENCHMARK_SCOPES)[number];

/** Zone des offres en télétravail complet (le pays reste celui de l'offre). */
export const REMOTE_AREA = "REMOTE";
/** Séniorité d'un repère toutes séniorités confondues. */
export const ALL_SENIORITIES = "ALL";

/** Séniorités des repères : `MANAGER` est fusionné avec `LEAD` (même rang). */
export type BenchmarkSeniority = Exclude<SeniorityCode, "MANAGER">;
const SENIORITY_OF_RANK: BenchmarkSeniority[] = [
  "INTERN",
  "JUNIOR",
  "MID",
  "SENIOR",
  "LEAD",
  "DIRECTOR",
  "EXECUTIVE",
];

export type BenchmarkOffer = {
  id: string;
  title: string;
  seniority: string | null;
  country: string | null;
  region: string | null;
  remotePolicy: RemotePolicy;
  contractType: ContractType;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string | null;
  salaryPeriod: SalaryPeriod | null;
  publishedAt: Date | null;
  firstSeenAt: Date;
  duplicateOfId: string | null;
};

export type BenchmarkKey = {
  family: JobFamily;
  /** `ALL` au niveau `FAMILY_COUNTRY`. */
  seniority: BenchmarkSeniority | typeof ALL_SENIORITIES;
  country: string;
  /** Région française ou `REMOTE` au niveau `REGION`, sinon `null`. */
  area: string | null;
};

export type ComputedBenchmark = BenchmarkKey & {
  scope: BenchmarkScope;
  key: string;
  sampleSize: number;
  p25: number;
  median: number;
  p75: number;
  periodStart: Date;
  periodEnd: Date;
};

/** Clé unique stockée en base. */
export function benchmarkKey(scope: BenchmarkScope, key: BenchmarkKey): string {
  return [scope, key.family, key.seniority, key.country, key.area ?? ""].join("|");
}

/** Séniorité d'une offre (intitulé puis expérience demandée), ou `null` si rien d'exploitable. */
export function offerSeniority(title: string, seniority: string | null): BenchmarkSeniority | null {
  const rank = offerSeniorityRank(title, seniority);
  return rank === null ? null : (SENIORITY_OF_RANK[rank] ?? null);
}

/** Séniorité déclarée par un candidat ramenée à l'échelle des repères. */
export function candidateSeniority(code: SeniorityCode | null): BenchmarkSeniority | null {
  return code === null ? null : (SENIORITY_OF_RANK[SENIORITY_RANK[code]] ?? null);
}

const FRENCH_REGIONS = new Set(Object.keys(REGION_DEPARTMENTS));

/** Zone d'une offre : `REMOTE`, région française officielle, ou `null`. */
export function offerArea(offer: {
  country: string | null;
  region: string | null;
  remotePolicy: RemotePolicy;
}): string | null {
  if (offer.remotePolicy === "FULL_REMOTE") return REMOTE_AREA;
  if (offer.country === "FR" && offer.region && FRENCH_REGIONS.has(offer.region)) {
    return offer.region;
  }
  return null;
}

/**
 * Salaire annuel brut en euros d'une offre : point médian de la fourchette
 * annoncée (ou la seule borne annoncée), annualisé et converti. `null` si
 * la période, la devise ou le montant ne permettent pas une valeur sûre.
 */
export function annualEur(
  offer: Pick<BenchmarkOffer, "salaryMin" | "salaryMax" | "salaryCurrency" | "salaryPeriod"> & {
    country: string | null;
  },
  config: BenchmarkConfig = BENCHMARK_CONFIG,
): number | null {
  const low = offer.salaryMin ?? offer.salaryMax;
  const high = offer.salaryMax ?? offer.salaryMin;
  if (low === null || high === null || !(low > 0) || !(high > 0)) return null;
  const currency =
    offer.salaryCurrency?.toUpperCase() ??
    (offer.country && config.euroCountries.includes(offer.country) ? "EUR" : null);
  const rate = currency ? config.eurRates[currency] : undefined;
  if (rate === undefined) return null;
  // Sans période, seul un montant manifestement annuel est retenu.
  const period = offer.salaryPeriod ?? (high >= 10_000 ? "YEAR" : null);
  if (!period) return null;
  return ((low + high) / 2) * config.annualFactors[period] * rate;
}

export function isSane(value: number, config: BenchmarkConfig = BENCHMARK_CONFIG): boolean {
  return value >= config.saneRange.min && value <= config.saneRange.max;
}

export type Sample = {
  family: JobFamily;
  seniority: BenchmarkSeniority | null;
  country: string;
  area: string | null;
  value: number;
  seenAt: Date;
};

export type SampleStats = {
  offers: number;
  duplicates: number;
  excludedContracts: number;
  noSalary: number;
  unclassified: number;
  outliers: number;
  samples: Sample[];
};

/** Offres → valeurs exploitables, avec le décompte de ce qui a été écarté. */
export function collectSamples(
  offers: BenchmarkOffer[],
  config: BenchmarkConfig = BENCHMARK_CONFIG,
): SampleStats {
  const stats: SampleStats = {
    offers: offers.length,
    duplicates: 0,
    excludedContracts: 0,
    noSalary: 0,
    unclassified: 0,
    outliers: 0,
    samples: [],
  };
  for (const offer of offers) {
    if (offer.duplicateOfId !== null) {
      stats.duplicates++;
      continue;
    }
    if (config.excludedContracts.includes(offer.contractType)) {
      stats.excludedContracts++;
      continue;
    }
    const value = annualEur(offer, config);
    if (value === null) {
      stats.noSalary++;
      continue;
    }
    const family = jobFamily(offer.title);
    if (!family || !offer.country) {
      stats.unclassified++;
      continue;
    }
    if (!isSane(value, config)) {
      stats.outliers++;
      continue;
    }
    stats.samples.push({
      family,
      seniority: offerSeniority(offer.title, offer.seniority),
      country: offer.country,
      area: offerArea(offer),
      value,
      seenAt: offer.publishedAt ?? offer.firstSeenAt,
    });
  }
  return stats;
}

/** Quantile à interpolation linéaire (méthode « type 7 »), sur des valeurs triées. */
export function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) throw new RangeError("échantillon vide");
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  return sorted[lower]! + (sorted[upper]! - sorted[lower]!) * (position - lower);
}

/** Arrondi à la centaine d'euros (pas de fausse précision). */
const round100 = (n: number) => Math.round(n / 100) * 100;

/** Niveaux auxquels une valeur contribue. */
function keysOf(sample: Sample): [BenchmarkScope, BenchmarkKey][] {
  const { family, seniority, country, area } = sample;
  const keys: [BenchmarkScope, BenchmarkKey][] = [
    ["FAMILY_COUNTRY", { family, seniority: ALL_SENIORITIES, country, area: null }],
  ];
  if (seniority) {
    keys.push(["COUNTRY", { family, seniority, country, area: null }]);
    if (area) keys.push(["REGION", { family, seniority, country, area }]);
  }
  return keys;
}

export type BucketResult = {
  published: ComputedBenchmark[];
  /** Repères sous le seuil, non publiés. */
  belowThreshold: number;
};

/** Regroupe les valeurs par repère et calcule ceux qui atteignent `minSample`. */
export function computeBenchmarks(
  samples: Sample[],
  config: BenchmarkConfig = BENCHMARK_CONFIG,
): BucketResult {
  const buckets = new Map<string, { scope: BenchmarkScope; key: BenchmarkKey; items: Sample[] }>();
  for (const sample of samples) {
    for (const [scope, key] of keysOf(sample)) {
      const id = benchmarkKey(scope, key);
      const bucket = buckets.get(id) ?? { scope, key, items: [] };
      bucket.items.push(sample);
      buckets.set(id, bucket);
    }
  }
  const published: ComputedBenchmark[] = [];
  let belowThreshold = 0;
  for (const [id, { scope, key, items }] of buckets) {
    if (items.length < config.minSample) {
      belowThreshold++;
      continue;
    }
    const values = items.map((s) => s.value).sort((a, b) => a - b);
    const times = items.map((s) => s.seenAt.getTime());
    published.push({
      ...key,
      scope,
      key: id,
      sampleSize: items.length,
      p25: round100(quantile(values, 0.25)),
      median: round100(quantile(values, 0.5)),
      p75: round100(quantile(values, 0.75)),
      periodStart: new Date(Math.min(...times)),
      periodEnd: new Date(Math.max(...times)),
    });
  }
  published.sort((a, b) => a.key.localeCompare(b.key));
  return { published, belowThreshold };
}

/**
 * Repères à essayer, du plus précis au plus large, pour une famille, une
 * séniorité (facultative) et une zone (facultative) d'un pays.
 */
export function fallbackChain(query: {
  family: JobFamily;
  seniority: BenchmarkSeniority | null;
  country: string;
  area: string | null;
}): { scope: BenchmarkScope; key: string }[] {
  const chain: { scope: BenchmarkScope; key: string }[] = [];
  const { family, seniority, country, area } = query;
  if (seniority && area) {
    chain.push({
      scope: "REGION",
      key: benchmarkKey("REGION", { family, seniority, country, area }),
    });
  }
  if (seniority) {
    chain.push({
      scope: "COUNTRY",
      key: benchmarkKey("COUNTRY", { family, seniority, country, area: null }),
    });
  }
  chain.push({
    scope: "FAMILY_COUNTRY",
    key: benchmarkKey("FAMILY_COUNTRY", {
      family,
      seniority: ALL_SENIORITIES,
      country,
      area: null,
    }),
  });
  return chain;
}

export type SalaryPosition = "BELOW" | "WITHIN" | "ABOVE";

/** Place une valeur annuelle face au repère : sous p25, entre p25 et p75, au-dessus de p75. */
export function positionAgainst(value: number, b: { p25: number; p75: number }): SalaryPosition {
  if (value < b.p25) return "BELOW";
  if (value > b.p75) return "ABOVE";
  return "WITHIN";
}
