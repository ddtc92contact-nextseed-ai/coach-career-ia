import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CandidateRails, MatchOffer } from "@/lib/matching/types";

/**
 * Recalcul par lots et pré-filtre SQL (issue #64) : mêmes résultats que le
 * calcul « tout en mémoire », garde-fous toujours appliqués en entier.
 */

const { PrismaClient } = await import("@/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { AiError, createAiClient, createMockProvider } = await import("@/lib/ai");
const { checkGuardRails } = await import("@/lib/matching/filters");
const { matchingConfig } = await import("@/lib/matching/config");
const { prefilteredOfferIds } = await import("@/lib/matching/prefilter");
const { recomputeUserMatches } = await import("@/lib/matching/recompute");
const { OFFERS } = await import("../fixtures/matching/cases");
const { BAG_OF_WORDS_RANGE, bagOfWordsEmbedding } = await import("../helpers/matching");

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url ?? "postgresql://absent/absent" }),
});
const run = `b${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const PARIS = { latitude: 48.8566, longitude: 2.3522 };

/** Variantes aux bords des garde-fous : distance, arrondis de salaire, devise, période. */
const EDGES: Partial<MatchOffer>[] = [
  ...[29.99, 30, 30.01, 4.99, 5.01].flatMap((km) =>
    [0, 90, 180, 270].map((bearing) => {
      const d = km / 6371.0088;
      const lat1 = (PARIS.latitude * Math.PI) / 180;
      const b = (bearing * Math.PI) / 180;
      const lat2 = Math.asin(
        Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b),
      );
      const lng2 =
        (PARIS.longitude * Math.PI) / 180 +
        Math.atan2(
          Math.sin(b) * Math.sin(d) * Math.cos(lat1),
          Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
        );
      return { latitude: (lat2 * 180) / Math.PI, longitude: (lng2 * 180) / Math.PI };
    }),
  ),
  ...(
    [
      [null, 54999.4, "EUR", "YEAR"],
      [null, 54999.5, "EUR", "YEAR"],
      [50000, 55000, "eur", "YEAR"],
      [4000, 4583.33, "EUR", "MONTH"],
      [4000, 4583.29, null, "MONTH"],
      [30, 34.22, "", "HOUR"],
      [200, 252.29, "EUR", "DAY"],
      [9999.99, null, null, null],
      [9000, 9999, null, null],
      [40000, 54000, "USD", "YEAR"],
      [-1, 50000, "EUR", "YEAR"],
      [60000, null, "EUR", null],
    ] as const
  ).map(([salaryMin, salaryMax, salaryCurrency, salaryPeriod]) => ({
    salaryMin,
    salaryMax,
    salaryCurrency,
    salaryPeriod,
  })),
  ...(["ONSITE", "HYBRID", "FULL_REMOTE", "UNKNOWN"] as const).flatMap((remotePolicy) =>
    (["CDI", "CDD", "FREELANCE", "UNKNOWN"] as const).map((contractType) => ({
      remotePolicy,
      contractType,
      latitude: null,
      longitude: null,
    })),
  ),
  { latitude: 0, longitude: 0 },
];

const offers: MatchOffer[] = OFFERS.flatMap((o) => [
  o,
  ...EDGES.map((edge, i) => ({ ...o, ...edge, id: `${o.id}-v${i}` })),
]).map((o) => ({ ...o, id: `${run}-${o.id}` }));

const BASE_RAILS: CandidateRails = {
  minFixedSalary: 55000,
  targetTotalPackage: 65000,
  remotePolicy: "HYBRID",
  minRemoteDays: 2,
  contractTypes: ["CDI"],
  excludedSectors: ["GAMBLING"],
  excludedCompanies: [],
  maxWeeklyHours: 39,
  acceptsOnCall: false,
  acceptsRemoteOutsideZone: false,
  culturePreferences: ["ASYNC_FIRST", "LEARNING_CULTURE"],
  locations: [{ ...PARIS, radiusKm: 30 }],
};
const OPEN: CandidateRails = {
  ...BASE_RAILS,
  minFixedSalary: null,
  remotePolicy: null,
  minRemoteDays: null,
  contractTypes: [],
  excludedSectors: [],
  maxWeeklyHours: null,
  acceptsOnCall: true,
  acceptsRemoteOutsideZone: false,
  locations: [],
};
const RAILS: Record<string, CandidateRails> = {
  base: BASE_RAILS,
  open: OPEN,
  fullRemote: { ...OPEN, remotePolicy: "FULL_REMOTE", minFixedSalary: 70000 },
  multi: {
    ...OPEN,
    minFixedSalary: 40000,
    minRemoteDays: 1,
    contractTypes: ["CDI", "CDD"],
    locations: [
      { latitude: 45.764, longitude: 4.8357, radiusKm: 5 },
      { ...PARIS, radiusKm: 5 },
      { latitude: null, longitude: null, radiusKm: 10 },
    ],
  },
  unlocated: { ...OPEN, locations: [{ latitude: null, longitude: null, radiusKm: 10 }] },
  zeroRadius: { ...OPEN, locations: [{ ...PARIS, radiusKm: 0 }] },
  // Télétravail complet hors zone (#66) : accord explicite, ou implicite (télétravail seul).
  remoteOutside: { ...BASE_RAILS, acceptsRemoteOutsideZone: true },
  remoteOnlyLocated: {
    ...OPEN,
    remotePolicy: "FULL_REMOTE",
    locations: [{ ...PARIS, radiusKm: 30 }],
  },
};

const config = { ...matchingConfig({}), semanticRange: BAG_OF_WORDS_RANGE, minScore: 0 };

function mockClient(options: { failEmbedAfter?: number } = {}) {
  const provider = createMockProvider({
    embedder: bagOfWordsEmbedding,
    respond: () => JSON.stringify({ summary: "Votre réalisation répond aux attentes du poste." }),
  });
  const embed = provider.embed.bind(provider);
  let calls = 0;
  provider.embed = async (texts, opts) => {
    if (options.failEmbedAfter !== undefined && ++calls > options.failEmbedAfter) {
      throw new AiError("unavailable");
    }
    return embed(texts, opts);
  };
  return createAiClient({ provider, sleep: async () => {}, backoffMs: 0 });
}

async function candidate(label: string, rails: CandidateRails) {
  const user = await db.user.create({ data: { email: `${label}-${run}@exemple.test` } });
  const skills = await Promise.all(
    ["Python", "SQL", "Airflow", "dbt"].map((name) =>
      db.skill.create({ data: { userId: user.id, name, nameKey: name.toLowerCase() } }),
    ),
  );
  await db.achievement.create({
    data: {
      userId: user.id,
      title: "Refonte des pipelines de données",
      actions: "Migration des traitements Python et SQL vers Airflow",
      evidenceLevel: "DOCUMENT",
      skills: { create: skills.slice(0, 3).map((s) => ({ skillId: s.id })) },
    },
  });
  const { locations, excludedCompanies, ...data } = rails;
  void excludedCompanies;
  await db.guardRails.create({ data: { userId: user.id, ...data } });
  for (const [i, location] of locations.entries()) {
    await db.guardRailLocation.create({ data: { userId: user.id, label: `L${i}`, ...location } });
  }
  return user.id;
}

async function snapshot(userId: string) {
  const rows = await db.match.findMany({
    where: { userId },
    orderBy: [{ score: "desc" }, { offerId: "asc" }],
  });
  return rows.map((m) => [m.offerId, m.score, m.inputHash, m.explanation, m.status]);
}

// Plusieurs recalculs complets par test.
describe.skipIf(!url)("matching : pré-filtre SQL et recalcul par lots", { timeout: 60_000 }, () => {
  beforeAll(async () => {
    const now = new Date();
    await db.jobOffer.createMany({
      data: offers.map((o) => ({
        ...o,
        source: "test-matching-batches",
        sourceKey: `test-matching-batches:${run}`,
        sourceId: o.id,
        url: `https://emplois.exemple.test/${o.id}`,
        urlKey: `emplois.exemple.test/${o.id}`,
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: o.id,
      })),
    });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: { endsWith: `-${run}@exemple.test` } } });
    await db.jobOffer.deleteMany({ where: { id: { startsWith: run } } });
    await db.$disconnect();
  });

  it("le pré-filtre ne retire jamais une offre qui respecte les garde-fous, et en retire", async () => {
    for (const [name, rails] of Object.entries(RAILS)) {
      const kept = new Set(await prefilteredOfferIds(db, rails));
      const passing = offers.filter((o) => checkGuardRails(o, rails).pass);
      expect(passing.length, name).toBeGreaterThan(0);
      for (const offer of passing) expect(kept.has(offer.id), `${name} ${offer.id}`).toBe(true);
      // Le pré-filtre n'est qu'une économie : les offres gardées passent encore les garde-fous.
      if (name !== "open" && name !== "unlocated") {
        const mine = offers.filter((o) => kept.has(o.id));
        expect(mine.length, name).toBeLessThan(offers.length);
      }
    }
  });

  it("mêmes correspondances, scores et explications quelle que soit la taille des lots", async () => {
    for (const [name, rails] of Object.entries(RAILS)) {
      const userId = await candidate(`lots-${name}`, rails);
      const results = [];
      for (const batchSize of [undefined, 1, 7]) {
        await db.match.deleteMany({ where: { userId } });
        await recomputeUserMatches(db, userId, {
          config: { ...config, maxPerUser: 25 },
          client: mockClient(),
          llmBudget: { remaining: 3 },
          batchSize,
        });
        results.push(await snapshot(userId));
      }
      expect(results[0]!.length, name).toBeGreaterThan(0);
      expect(results[1], name).toEqual(results[0]);
      expect(results[2], name).toEqual(results[0]);
    }
  });

  it("une offre sauvegardée hors du top reste retenue d'un lot à l'autre", async () => {
    const userId = await candidate("epinglee", OPEN);
    const deps = { client: null, llmBudget: { remaining: 0 } };
    await recomputeUserMatches(db, userId, { ...deps, config: { ...config, maxPerUser: 50 } });
    const last = (await snapshot(userId)).at(-1)!;
    await db.match.update({
      where: { userId_offerId: { userId, offerId: last[0] as string } },
      data: { status: "SAVED" },
    });
    const results = [];
    for (const batchSize of [undefined, 3]) {
      await recomputeUserMatches(db, userId, {
        ...deps,
        config: { ...config, maxPerUser: 5 },
        batchSize,
      });
      results.push(await snapshot(userId));
    }
    expect(results[0]).toHaveLength(6);
    expect(results[0]!.map((m) => m[0])).toContain(last[0]);
    expect(results[1]).toEqual(results[0]);
  });

  it("embeddings en panne au milieu du parcours : tout est recalculé sans eux", async () => {
    const userId = await candidate("panne", BASE_RAILS);
    await db.memoryEmbedding.deleteMany({ where: { userId } });
    await db.offerEmbedding.deleteMany({ where: { offerId: { startsWith: run } } });
    const deps = { config: { ...config, maxPerUser: 25 }, llmBudget: { remaining: 0 } };

    const down = await recomputeUserMatches(db, userId, {
      ...deps,
      client: mockClient({ failEmbedAfter: 0 }),
    });
    const expected = await snapshot(userId);
    await db.match.deleteMany({ where: { userId } });

    // Premier lot embarqué, panne au lot suivant.
    const midway = await recomputeUserMatches(db, userId, {
      ...deps,
      client: mockClient({ failEmbedAfter: 2 }),
      batchSize: 2,
    });
    expect(down).toMatchObject({ status: "done", semantic: false });
    expect(midway).toMatchObject({ status: "done", semantic: false });
    expect(await snapshot(userId)).toEqual(expected);
  });
});
