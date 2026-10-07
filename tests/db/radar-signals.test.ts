import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { runConnectors } from "@/lib/radar/pipeline";
import type { HistoryOffer } from "@/lib/radar/signals/compute";
import { runCompanySignals } from "@/lib/radar/signals/job";
import { loadCompanyMomentum, loadCompanySignals } from "@/lib/radar/signals/query";
import type { Connector, NormalizedOffer } from "@/lib/radar/types";
import { testHttp, fakeFetch } from "../helpers/radar";
import { at, offer, steady, surge, tooYoung } from "../fixtures/radar/signals-histories";

const url = process.env.TEST_DATABASE_URL;
const silent = createLogger({ write: () => {} });
/** Semaines 1 à 8 terminées. */
const NOW = at(9, 2);

async function insertHistory(prisma: PrismaClient, slug: string, history: HistoryOffer[]) {
  const company = await prisma.company.create({ data: { slug, name: slug.toUpperCase() } });
  const ids = new Map<string, string>();
  // Offres canoniques d'abord : les doublons y renvoient.
  const ordered = [...history].sort(
    (a, b) => Number(a.duplicateOfId !== null) - Number(b.duplicateOfId !== null),
  );
  for (const o of ordered) {
    const row = await prisma.jobOffer.create({
      data: {
        source: o.duplicateOfId ? "france_travail" : "greenhouse",
        sourceKey: o.duplicateOfId ? "france_travail" : `greenhouse:${slug}`,
        sourceId: `${slug}-${o.id}`,
        url: `https://boards.example.test/${slug}/${o.id}`,
        urlKey: `boards.example.test/${slug}/${o.id}`,
        dedupKey: o.dedupKey,
        title: o.title,
        companyName: slug,
        companyId: company.id,
        description: "Offre de test",
        city: o.city,
        country: o.country,
        remotePolicy: o.remotePolicy,
        salaryMin: o.hasSalary ? 50000 : null,
        firstSeenAt: o.firstSeenAt,
        lastSeenAt: o.closedAt ?? NOW,
        closedAt: o.closedAt,
        status: o.closedAt ? "CLOSED" : "OPEN",
        reopenedAt: o.reopenedAt,
        reopenCount: o.reopenCount,
        contentHash: o.id,
        duplicateOfId: o.duplicateOfId ? ids.get(o.duplicateOfId)! : null,
      },
    });
    ids.set(o.id, row.id);
  }
  return company;
}

const signalRows = (prisma: PrismaClient) =>
  prisma.companySignal.findMany({ orderBy: [{ periodStart: "asc" }, { type: "asc" }] });

describe.skipIf(!url)("Signaux faibles d'entreprise (en base)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  beforeEach(async () => {
    await prisma.jobOffer.deleteMany({});
    await prisma.sourceRun.deleteMany({});
    await prisma.company.deleteMany({});
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("détecte un pic et reste idempotent quand on relance la même semaine", async () => {
    const company = await insertHistory(prisma, "acme", surge());
    const first = await runCompanySignals(prisma, { now: () => NOW, logger: silent });
    expect(first).toMatchObject({ companies: 1, signals: 1, failed: 0 });
    const before = await signalRows(prisma);
    expect(before.map((s) => [s.type, s.periodStart.toISOString()])).toEqual([
      ["HIRING_SURGE", at(8, 0).toISOString()],
    ]);

    await runCompanySignals(prisma, { now: () => NOW, logger: silent });
    await runCompanySignals(prisma, { now: () => at(9, 5), logger: silent });
    const after = await signalRows(prisma);
    expect(after.map((s) => [s.id, s.detectedAt.toISOString()])).toEqual(
      before.map((s) => [s.id, s.detectedAt.toISOString()]),
    );
    // Une ligne de statistiques par semaine observée (semaines 1 à 8).
    expect(await prisma.companyWeekStat.count({ where: { companyId: company.id } })).toBe(8);
    const week8 = await prisma.companyWeekStat.findUniqueOrThrow({
      where: { companyId_weekStart: { companyId: company.id, weekStart: at(8, 0) } },
    });
    expect(week8.newOffers).toBe(8);

    const signals = await loadCompanySignals(prisma, company.id, { now: NOW });
    expect(signals).toHaveLength(1);
    expect(signals[0]!.facts).toMatchObject({ type: "HIRING_SURGE", newOffers: 8 });
  });

  it("ne compte pas deux fois les doublons d'une autre source", async () => {
    const canonical = offer({ week: 8 });
    const history = [
      ...steady(8),
      canonical,
      offer({ week: 8 }),
      offer({ week: 8 }),
      ...Array.from({ length: 5 }, () => offer({ week: 8, duplicateOf: canonical.id })),
    ];
    const company = await insertHistory(prisma, "dupli", history);
    await runCompanySignals(prisma, { now: () => NOW, logger: silent });
    expect(await signalRows(prisma)).toEqual([]);
    const week8 = await prisma.companyWeekStat.findUniqueOrThrow({
      where: { companyId_weekStart: { companyId: company.id, weekStart: at(8, 0) } },
    });
    expect(week8.newOffers).toBe(3);
  });

  it("supprime un signal qui ne tient plus après correction des offres", async () => {
    const company = await insertHistory(prisma, "acme", surge());
    await runCompanySignals(prisma, { now: () => NOW, logger: silent });
    expect(await prisma.companySignal.count()).toBe(1);
    await prisma.jobOffer.deleteMany({
      where: { companyId: company.id, firstSeenAt: { gte: at(8, 0) } },
    });
    await runCompanySignals(prisma, { now: () => NOW, logger: silent });
    expect(await prisma.companySignal.count()).toBe(0);
  });

  it("aucun signal pour une entreprise sans historique suffisant", async () => {
    await insertHistory(prisma, "jeune", tooYoung());
    const summary = await runCompanySignals(prisma, { now: () => NOW, logger: silent });
    expect(summary.signals).toBe(0);
    const [momentum] = await loadCompanyMomentum(prisma, { now: NOW });
    expect(momentum).toMatchObject({ name: "JEUNE", openOffers: 20, signals: [] });
  });

  it("le pipeline note la réouverture d'une offre fermée", async () => {
    const base: NormalizedOffer = {
      sourceId: "a",
      url: "https://boards.example.test/acme/a",
      title: "Data analyst",
      companyName: "Acme",
      description: "Analyse de données",
      location: { city: "Paris", region: null, country: "FR" },
      remotePolicy: "HYBRID",
      contractType: "CDI",
      contractLabel: null,
      salary: null,
      sector: null,
      seniority: null,
      publishedAt: null,
    };
    let items: NormalizedOffer[] = [];
    const connector: Connector<NormalizedOffer> = {
      source: "greenhouse",
      key: "greenhouse:acme",
      fetch: async () => ({ items, complete: true }),
      map: (raw) => raw,
    };
    const run = (when: string) =>
      runConnectors(prisma, [connector as Connector<unknown>], {
        http: testHttp(fakeFetch(() => new Response("", { status: 404 }))),
        now: () => new Date(when),
        logger: silent,
      });

    items = [base, { ...base, sourceId: "b", url: "https://boards.example.test/acme/b" }];
    await run("2026-09-01T06:00:00Z");
    items = [items[1]!];
    await run("2026-09-08T06:00:00Z");
    expect(await prisma.jobOffer.findFirstOrThrow({ where: { sourceId: "a" } })).toMatchObject({
      status: "CLOSED",
      reopenCount: 0,
    });
    items = [base, items[0]!];
    await run("2026-09-15T06:00:00Z");
    await run("2026-09-22T06:00:00Z");
    const reopened = await prisma.jobOffer.findFirstOrThrow({ where: { sourceId: "a" } });
    expect(reopened).toMatchObject({ status: "OPEN", closedAt: null, reopenCount: 1 });
    expect(reopened.reopenedAt?.toISOString()).toBe("2026-09-15T06:00:00.000Z");
  });
});
