import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import type { BenchmarkOffer } from "@/lib/radar/benchmarks/compute";
import { BENCHMARK_CONFIG } from "@/lib/radar/benchmarks/config";
import { runSalaryBenchmarks } from "@/lib/radar/benchmarks/job";
import {
  benchmarkForOffer,
  getCandidateSalaryBenchmark,
  getOfferSalaryBenchmark,
  getSalaryBenchmark,
} from "@/lib/radar/salary-benchmarks";
import { COLLECTED_AT, salaryOffer, series } from "../fixtures/radar/salary-offers";

const url = process.env.TEST_DATABASE_URL;
const NOW = new Date("2026-10-01T00:00:00.000Z");
const config = { ...BENCHMARK_CONFIG, minSample: 10 };

async function insertOffers(prisma: PrismaClient, offers: BenchmarkOffer[]) {
  const ids = new Map<string, string>();
  const ordered = [...offers].sort(
    (a, b) => Number(a.duplicateOfId !== null) - Number(b.duplicateOfId !== null),
  );
  for (const o of ordered) {
    const row = await prisma.jobOffer.create({
      data: {
        source: "greenhouse",
        sourceKey: "greenhouse:bench",
        sourceId: `bench-${o.id}`,
        url: `https://boards.example.test/bench/${o.id}`,
        urlKey: `boards.example.test/bench/${o.id}`,
        title: o.title,
        description: "Offre de test",
        country: o.country,
        region: o.region,
        remotePolicy: o.remotePolicy,
        contractType: o.contractType,
        seniority: o.seniority,
        salaryMin: o.salaryMin,
        salaryMax: o.salaryMax,
        salaryCurrency: o.salaryCurrency,
        salaryPeriod: o.salaryPeriod,
        publishedAt: o.publishedAt,
        firstSeenAt: o.firstSeenAt,
        lastSeenAt: COLLECTED_AT,
        contentHash: o.id,
        duplicateOfId: o.duplicateOfId ? ids.get(o.duplicateOfId)! : null,
      },
    });
    ids.set(o.id, row.id);
  }
  return ids;
}

describe.skipIf(!url)("Repères de salaire (en base)", () => {
  let prisma: PrismaClient;
  const lines: string[] = [];
  const logger = createLogger({ write: (_level, line) => lines.push(line) });

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  beforeEach(async () => {
    lines.length = 0;
    await prisma.salaryBenchmark.deleteMany({});
    await prisma.jobOffer.deleteMany({});
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("calcule les repères sur les offres enregistrées et reste idempotent", async () => {
    await insertOffers(prisma, [
      ...series(10, 50_000, 2_000),
      salaryOffer({ salaryMin: null, salaryMax: null }),
    ]);
    const first = await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });
    expect(first).toMatchObject({ offers: 10, samples: 10, published: 3, failed: 0, removed: 0 });
    const snapshot = await prisma.salaryBenchmark.findMany({ orderBy: { key: "asc" } });

    const second = await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });
    expect(second).toMatchObject({ published: 3, removed: 0 });
    const again = await prisma.salaryBenchmark.findMany({ orderBy: { key: "asc" } });
    expect(
      again.map(({ id, key, p25, median, p75, sampleSize }) => ({
        id,
        key,
        p25,
        median,
        p75,
        sampleSize,
      })),
    ).toEqual(
      snapshot.map(({ id, key, p25, median, p75, sampleSize }) => ({
        id,
        key,
        p25,
        median,
        p75,
        sampleSize,
      })),
    );
    // Journal : des comptes, aucune offre ni aucun montant.
    expect(lines.some((l) => l.includes("radar.benchmarks.finished"))).toBe(true);
    expect(lines.join("\n")).not.toMatch(/Data Engineer|50000|59000/);
  });

  it("supprime un repère passé sous le seuil et n'en publie aucun pour les doublons", async () => {
    const ids = await insertOffers(prisma, series(10, 50_000, 2_000));
    await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });
    expect(await prisma.salaryBenchmark.count()).toBe(3);

    // Une offre devient le doublon d'une autre : 9 offres canoniques seulement.
    const [first, second] = [...ids.values()];
    await prisma.jobOffer.update({ where: { id: second! }, data: { duplicateOfId: first! } });
    const summary = await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });
    expect(summary).toMatchObject({ samples: 9, published: 0, removed: 3 });
    expect(await prisma.salaryBenchmark.count()).toBe(0);
  });

  it("ignore les offres plus anciennes que la période glissante", async () => {
    await insertOffers(
      prisma,
      series(10, 50_000, 2_000, { firstSeenAt: new Date("2025-01-01T00:00:00.000Z") }),
    );
    const summary = await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });
    expect(summary).toMatchObject({ offers: 0, published: 0 });
  });

  it("un repère en erreur n'empêche pas les autres", async () => {
    await insertOffers(prisma, series(10, 50_000, 2_000));
    const failing = new Proxy(prisma, {
      get(target, prop, receiver) {
        if (prop !== "salaryBenchmark") return Reflect.get(target, prop, receiver);
        const delegate = target.salaryBenchmark;
        return new Proxy(delegate, {
          get(d, p, r) {
            if (p !== "upsert") return Reflect.get(d, p, r);
            return (args: { where: { key: string } }) =>
              args.where.key.startsWith("REGION|")
                ? Promise.reject(new Error("panne simulée"))
                : delegate.upsert(args as Parameters<typeof delegate.upsert>[0]);
          },
        });
      },
    });
    const summary = await runSalaryBenchmarks(failing, { now: () => NOW, logger, config });
    expect(summary).toMatchObject({ published: 2, failed: 1 });
    expect((await prisma.salaryBenchmark.findMany()).map((b) => b.scope).sort()).toEqual([
      "COUNTRY",
      "FAMILY_COUNTRY",
    ]);
    expect(lines.some((l) => l.includes("radar.benchmarks.bucket_failed"))).toBe(true);
  });

  it("se rabat sur le niveau publié le plus précis et le dit", async () => {
    await insertOffers(prisma, [
      ...series(6, 50_000, 2_000),
      ...series(6, 45_000, 2_000, { region: "Auvergne-Rhône-Alpes" }),
    ]);
    await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });

    const country = await getSalaryBenchmark(
      prisma,
      { family: "DATA_AI", seniority: "SENIOR", country: "FR", area: "Île-de-France" },
      config,
    );
    expect(country).toMatchObject({
      scope: "COUNTRY",
      fallback: true,
      sampleSize: 12,
      seniority: "SENIOR",
    });
    expect(country!.period.from).toBeInstanceOf(Date);

    const family = await getSalaryBenchmark(
      prisma,
      { family: "DATA_AI", seniority: "JUNIOR", country: "FR" },
      config,
    );
    expect(family).toMatchObject({ scope: "FAMILY_COUNTRY", fallback: true, seniority: "ALL" });

    // Aucun niveau publié : pas de chiffre.
    expect(
      await getSalaryBenchmark(prisma, { family: "LEGAL", seniority: null, country: "FR" }, config),
    ).toBeNull();
    // Seuil relevé à la lecture : le repère publié n'est plus montré.
    expect(
      await getSalaryBenchmark(
        prisma,
        { family: "DATA_AI", seniority: "SENIOR", country: "FR" },
        { minSample: 50 },
      ),
    ).toBeNull();
  });

  it("situe une offre face au repère", async () => {
    const ids = await insertOffers(prisma, [
      ...series(10, 50_000, 2_000),
      salaryOffer({ id: "low", salaryMin: 3_000, salaryMax: 3_400, salaryPeriod: "MONTH" }),
      salaryOffer({ id: "none", salaryMin: null, salaryMax: null }),
    ]);
    await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });

    const low = await getOfferSalaryBenchmark(prisma, ids.get("low")!, config);
    expect(low).toMatchObject({ offerAnnual: 38_400, position: "BELOW" });
    expect(low!.benchmark!.scope).toBe("REGION");

    const none = await getOfferSalaryBenchmark(prisma, ids.get("none")!, config);
    expect(none).toMatchObject({ offerAnnual: null, position: null });
    expect(none!.benchmark).not.toBeNull();

    // Intitulé non classable : aucun repère possible.
    expect(await benchmarkForOffer(prisma, salaryOffer({ title: "Boulanger" }), config)).toBeNull();
    expect(await getOfferSalaryBenchmark(prisma, "inconnue", config)).toBeNull();
  });

  it("donne le repère du métier visé par le candidat (poste le plus récent)", async () => {
    await insertOffers(prisma, series(10, 50_000, 2_000));
    await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });
    const user = await prisma.user.create({
      data: { email: `bench-${Date.now()}@example.test` },
    });
    try {
      expect(await getCandidateSalaryBenchmark(prisma, user.id, config)).toBeNull();
      await prisma.experience.create({
        data: {
          userId: user.id,
          roleTitle: "Senior Data Engineer",
          startMonth: new Date("2022-01-01"),
          seniority: "SENIOR",
          contractType: "CDI",
          sector: "SAAS_SOFTWARE",
          companySize: "S51_200",
          companyStage: "SCALEUP",
        },
      });
      const result = await getCandidateSalaryBenchmark(prisma, user.id, config);
      expect(result).toMatchObject({ family: "DATA_AI", seniority: "SENIOR" });
      expect(result!.benchmark).toMatchObject({ scope: "COUNTRY", sampleSize: 10 });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });

  it("donne à un Product Manager SENIOR le repère PRODUCT × SENIOR (pas un repli)", async () => {
    await insertOffers(prisma, [
      ...series(8, 60_000, 2_000, { title: "Product Manager Senior" }),
      ...series(7, 62_000, 2_000, { title: "Senior Product Manager" }),
      ...series(5, 45_000, 2_000, { title: "Product Manager Junior" }),
    ]);
    await runSalaryBenchmarks(prisma, { now: () => NOW, logger, config });
    const user = await prisma.user.create({
      data: { email: `bench-pm-${Date.now()}@example.test` },
    });
    try {
      await prisma.experience.create({
        data: {
          userId: user.id,
          roleTitle: "Product manager",
          startMonth: new Date("2021-01-01"),
          seniority: "SENIOR",
          contractType: "CDI",
          sector: "SAAS_SOFTWARE",
          companySize: "S51_200",
          companyStage: "SCALEUP",
        },
      });
      const result = await getCandidateSalaryBenchmark(prisma, user.id, config);
      expect(result).toMatchObject({ family: "PRODUCT", seniority: "SENIOR" });
      expect(result!.benchmark).toMatchObject({
        scope: "COUNTRY",
        fallback: false,
        seniority: "SENIOR",
        sampleSize: 15,
      });

      const offer = await benchmarkForOffer(
        prisma,
        salaryOffer({ title: "Product Manager Senior", salaryMin: 70_000, salaryMax: 70_000 }),
        config,
      );
      expect(offer!.benchmark).toMatchObject({ scope: "REGION", seniority: "SENIOR" });
    } finally {
      await prisma.user.delete({ where: { id: user.id } });
    }
  });
});
