import { describe, expect, it } from "vitest";
import {
  annualEur,
  benchmarkKey,
  candidateSeniority,
  collectSamples,
  computeBenchmarks,
  fallbackChain,
  offerArea,
  offerSeniority,
  positionAgainst,
  quantile,
} from "@/lib/radar/benchmarks/compute";
import {
  BENCHMARK_CONFIG,
  minSampleFromEnv,
  type BenchmarkConfig,
} from "@/lib/radar/benchmarks/config";
import { salaryOffer, series } from "../fixtures/radar/salary-offers";

const config: BenchmarkConfig = { ...BENCHMARK_CONFIG, minSample: 10 };
const published = (offers: Parameters<typeof collectSamples>[0], c = config) =>
  computeBenchmarks(collectSamples(offers, c).samples, c).published;

describe("annualisation des salaires publiés", () => {
  it("annualise heure, jour, mois et année avec les hypothèses de la config", () => {
    const base = { salaryCurrency: "EUR", country: "FR" };
    expect(annualEur({ ...base, salaryMin: 45_000, salaryMax: 55_000, salaryPeriod: "YEAR" })).toBe(
      50_000,
    );
    expect(annualEur({ ...base, salaryMin: 3_000, salaryMax: 3_500, salaryPeriod: "MONTH" })).toBe(
      39_000,
    );
    expect(annualEur({ ...base, salaryMin: 400, salaryMax: null, salaryPeriod: "DAY" })).toBe(
      400 * 218,
    );
    expect(annualEur({ ...base, salaryMin: 20, salaryMax: 20, salaryPeriod: "HOUR" })).toBe(
      20 * 1607,
    );
  });

  it("convertit les devises de la table et ignore les autres", () => {
    expect(
      annualEur({
        salaryMin: 50_000,
        salaryMax: 50_000,
        salaryCurrency: "GBP",
        salaryPeriod: "YEAR",
        country: "GB",
      }),
    ).toBeCloseTo(50_000 * BENCHMARK_CONFIG.eurRates.GBP!);
    expect(
      annualEur({
        salaryMin: 5_000_000,
        salaryMax: 6_000_000,
        salaryCurrency: "JPY",
        salaryPeriod: "YEAR",
        country: "JP",
      }),
    ).toBeNull();
  });

  it("ne suppose l'euro sans devise que dans un pays de la zone euro", () => {
    const offer = {
      salaryMin: 50_000,
      salaryMax: 60_000,
      salaryCurrency: null,
      salaryPeriod: null,
    };
    expect(annualEur({ ...offer, country: "FR" })).toBe(55_000);
    expect(annualEur({ ...offer, country: "US" })).toBeNull();
    expect(annualEur({ ...offer, country: null })).toBeNull();
  });

  it("n'invente rien : sans montant ni période sûre, aucune valeur", () => {
    const base = { salaryCurrency: "EUR", country: "FR" };
    expect(
      annualEur({ ...base, salaryMin: null, salaryMax: null, salaryPeriod: "YEAR" }),
    ).toBeNull();
    // 3 000 sans période : mensuel ? annuel ? on ne devine pas.
    expect(
      annualEur({ ...base, salaryMin: 3_000, salaryMax: null, salaryPeriod: null }),
    ).toBeNull();
  });
});

describe("classement des offres", () => {
  it("déduit la séniorité de l'intitulé puis de l'expérience demandée", () => {
    expect(offerSeniority("Data Engineer Senior", null)).toBe("SENIOR");
    expect(offerSeniority("Head of Data", null)).toBe("DIRECTOR");
    expect(offerSeniority("Data Analyst", "3 An(s)")).toBe("MID");
    expect(offerSeniority("Data Analyst", null)).toBeNull();
    expect(candidateSeniority("MANAGER")).toBe("LEAD");
    expect(candidateSeniority(null)).toBeNull();
  });

  it("fait passer les qualificatifs explicites avant le mot « manager »", () => {
    expect(offerSeniority("Product Manager Junior", null)).toBe("JUNIOR");
    expect(offerSeniority("Product Manager Senior", null)).toBe("SENIOR");
    expect(offerSeniority("Senior Product Manager", null)).toBe("SENIOR");
    expect(offerSeniority("Lead Product Manager", null)).toBe("LEAD");
    expect(offerSeniority("Account Manager Junior", null)).toBe("JUNIOR");
    expect(offerSeniority("Senior Account Manager", null)).toBe("SENIOR");
    expect(offerSeniority("Engineering Manager", null)).toBe("LEAD");
    expect(offerSeniority("Head of Product", null)).toBe("DIRECTOR");
    // Sans qualificatif : le métier, pas un niveau ; l'expérience demandée tranche.
    expect(offerSeniority("Product Manager", null)).toBeNull();
    expect(offerSeniority("Product Manager", "6 An(s)")).toBe("SENIOR");
    // Même échelle côté candidat : un PM déclaré SENIOR retrouve les offres SENIOR.
    expect(candidateSeniority("SENIOR")).toBe(offerSeniority("Senior Product Manager", null));
  });

  it("publie un repère PRODUCT × SENIOR à partir d'offres « Product Manager Senior »", () => {
    const offers = [
      ...series(8, 60_000, 2_000, { title: "Product Manager Senior" }),
      ...series(7, 62_000, 2_000, { title: "Senior Product Manager" }),
    ];
    const keys = published(offers).map((b) => b.key);
    expect(keys).toContain("REGION|PRODUCT|SENIOR|FR|Île-de-France");
    expect(keys).toContain("COUNTRY|PRODUCT|SENIOR|FR|");
    expect(keys.some((k) => k.includes("|LEAD|"))).toBe(false);
  });

  it("range une offre dans sa région française, ou dans le télétravail complet", () => {
    expect(offerArea({ country: "FR", region: "Île-de-France", remotePolicy: "HYBRID" })).toBe(
      "Île-de-France",
    );
    expect(offerArea({ country: "FR", region: "Île-de-France", remotePolicy: "FULL_REMOTE" })).toBe(
      "REMOTE",
    );
    expect(offerArea({ country: "DE", region: "Bayern", remotePolicy: "ONSITE" })).toBeNull();
    expect(offerArea({ country: "FR", region: "Inconnue", remotePolicy: "ONSITE" })).toBeNull();
  });
});

describe("quantiles", () => {
  it("interpole linéairement", () => {
    expect(quantile([10, 20, 30, 40, 50], 0.5)).toBe(30);
    expect(quantile([10, 20, 30, 40, 50], 0.25)).toBe(20);
    expect(quantile([10, 20, 30, 40], 0.5)).toBe(25);
    expect(() => quantile([], 0.5)).toThrow();
  });
});

describe("repères de salaire", () => {
  it("calcule p25 / médiane / p75, la taille d'échantillon et la période sur une région", () => {
    const offers = series(10, 50_000, 2_000);
    const region = published(offers).find((b) => b.scope === "REGION")!;
    expect(region).toMatchObject({
      family: "DATA_AI",
      seniority: "SENIOR",
      country: "FR",
      area: "Île-de-France",
      sampleSize: 10,
      p25: 54_500,
      median: 59_000,
      p75: 63_500,
    });
    expect(region.periodStart).toEqual(offers.at(-1)!.firstSeenAt);
    expect(region.periodEnd).toEqual(offers[0]!.firstSeenAt);
    expect(region.key).toBe("REGION|DATA_AI|SENIOR|FR|Île-de-France");
  });

  it("écarte les doublons inter-sources et les offres sans salaire", () => {
    const canonical = series(9, 50_000, 2_000);
    const offers = [
      ...canonical,
      // Le doublon d'une offre France Travail ne doit pas faire franchir le seuil.
      salaryOffer({ duplicateOfId: canonical[0]!.id }),
      salaryOffer({ salaryMin: null, salaryMax: null }),
    ];
    const stats = collectSamples(offers, config);
    expect(stats).toMatchObject({ duplicates: 1, noSalary: 1 });
    expect(stats.samples).toHaveLength(9);
    expect(published(offers)).toEqual([]);
  });

  it("écarte les valeurs hors de la plage plausible (configurable)", () => {
    const offers = [
      ...series(10, 50_000, 2_000),
      // 4 500 €/an : montant mensuel saisi comme annuel.
      salaryOffer({ salaryMin: 4_500, salaryMax: 4_500 }),
      salaryOffer({ salaryMin: 2_000_000, salaryMax: 2_000_000 }),
    ];
    const stats = collectSamples(offers, config);
    expect(stats.outliers).toBe(2);
    expect(published(offers).find((b) => b.scope === "REGION")!.median).toBe(59_000);

    const strict = { ...config, saneRange: { min: 55_000, max: 60_000 } };
    expect(collectSamples(offers, strict).samples.map((s) => s.value)).toEqual([
      56_000, 58_000, 60_000,
    ]);
  });

  it("exclut les contrats dont la rémunération n'est pas un salaire comparable", () => {
    const offers = series(10, 50_000, 2_000, { contractType: "FREELANCE" });
    expect(collectSamples(offers, config).excludedContracts).toBe(10);
    expect(published(offers)).toEqual([]);
  });

  it("ne publie pas un repère sous le seuil et publie le niveau plus large", () => {
    // 6 offres en Île-de-France, 6 en Auvergne-Rhône-Alpes : aucune région ne
    // franchit le seuil de 10, mais le pays (12) oui.
    const offers = [
      ...series(6, 50_000, 2_000),
      ...series(6, 45_000, 2_000, { region: "Auvergne-Rhône-Alpes" }),
    ];
    const { published: rows, belowThreshold } = computeBenchmarks(
      collectSamples(offers, config).samples,
      config,
    );
    expect(rows.map((b) => b.key)).toEqual([
      "COUNTRY|DATA_AI|SENIOR|FR|",
      "FAMILY_COUNTRY|DATA_AI|ALL|FR|",
    ]);
    expect(belowThreshold).toBe(2);
  });

  it("compte les offres sans séniorité au seul niveau famille × pays", () => {
    const offers = series(10, 50_000, 2_000, { title: "Data Analyst" });
    expect(published(offers).map((b) => b.scope)).toEqual(["FAMILY_COUNTRY"]);
  });

  it("isole les offres en télétravail complet dans le repère REMOTE", () => {
    const offers = series(10, 60_000, 1_000, { remotePolicy: "FULL_REMOTE" });
    expect(published(offers).map((b) => b.key)).toContain("REGION|DATA_AI|SENIOR|FR|REMOTE");
  });

  it("lit le seuil minimal depuis l'environnement (défaut 10)", () => {
    expect(minSampleFromEnv(undefined)).toBe(10);
    expect(minSampleFromEnv("25")).toBe(25);
    expect(minSampleFromEnv("1")).toBe(10);
    expect(minSampleFromEnv("abc")).toBe(10);
  });

  it("est déterministe (même entrée, même sortie)", () => {
    const offers = series(12, 40_000, 3_000);
    expect(published(offers)).toEqual(published([...offers].reverse()));
  });
});

describe("repli et position", () => {
  it("essaie la région, puis le pays, puis la famille toutes séniorités", () => {
    const chain = fallbackChain({
      family: "DATA_AI",
      seniority: "SENIOR",
      country: "FR",
      area: "Bretagne",
    });
    expect(chain).toEqual([
      { scope: "REGION", key: "REGION|DATA_AI|SENIOR|FR|Bretagne" },
      { scope: "COUNTRY", key: "COUNTRY|DATA_AI|SENIOR|FR|" },
      { scope: "FAMILY_COUNTRY", key: "FAMILY_COUNTRY|DATA_AI|ALL|FR|" },
    ]);
    expect(
      fallbackChain({ family: "SALES", seniority: null, country: "FR", area: "Bretagne" }),
    ).toEqual([
      {
        scope: "FAMILY_COUNTRY",
        key: benchmarkKey("FAMILY_COUNTRY", {
          family: "SALES",
          seniority: "ALL",
          country: "FR",
          area: null,
        }),
      },
    ]);
  });

  it("situe une valeur sous p25, entre p25 et p75, ou au-dessus de p75", () => {
    const b = { p25: 50_000, p75: 60_000 };
    expect(positionAgainst(45_000, b)).toBe("BELOW");
    expect(positionAgainst(50_000, b)).toBe("WITHIN");
    expect(positionAgainst(60_000, b)).toBe("WITHIN");
    expect(positionAgainst(61_000, b)).toBe("ABOVE");
  });
});
