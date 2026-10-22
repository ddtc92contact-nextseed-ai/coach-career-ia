import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { CandidateRails } from "@/lib/matching/types";

/**
 * Embeddings des offres (issue #69) : une offre que le fournisseur refuse
 * (400) est isolée, ignorée et mémorisée ; les autres gardent leur
 * similarité sémantique. Les offres au texte vide ne sont jamais envoyées.
 */

const { PrismaClient } = await import("@/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { AiError, createAiClient, createMockProvider } = await import("@/lib/ai");
const { createLogger } = await import("@/lib/logger");
const { matchingConfig } = await import("@/lib/matching/config");
const { offerEmbeddingText, textHash } = await import("@/lib/matching/embeddings");
const { recomputeUserMatches } = await import("@/lib/matching/recompute");
const { OFFERS } = await import("../fixtures/matching/cases");
const { BAG_OF_WORDS_RANGE, bagOfWordsEmbedding } = await import("../helpers/matching");

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url ?? "postgresql://absent/absent" }),
});
const run = `e${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;

const POISON = "Référence interne ZZ-POISON";
const great = OFFERS.find((o) => o.id === "de-great")!;
/** 32 offres qualifiées, dont une « empoisonnée », plus une offre sans texte. */
const offers = [
  ...Array.from({ length: 32 }, (_, i) => ({
    ...great,
    id: `${run}-o${String(i).padStart(2, "0")}`,
    title: `${great.title} ${run} ${i}`,
    description: i === 13 ? `${great.description}\n${POISON}` : great.description,
  })),
  { ...great, id: `${run}-vide`, title: "  ", description: "\n" },
];
const poisoned = offers[13]!;

const RAILS: CandidateRails = {
  minFixedSalary: null,
  targetTotalPackage: null,
  remotePolicy: null,
  minRemoteDays: null,
  contractTypes: [],
  excludedSectors: [],
  excludedCompanies: [],
  maxWeeklyHours: null,
  acceptsOnCall: true,
  acceptsRemoteOutsideZone: false,
  culturePreferences: [],
  locations: [],
};
const config = {
  ...matchingConfig({}),
  semanticRange: BAG_OF_WORDS_RANGE,
  minScore: 0,
  maxPerUser: 50,
  llmExplanations: false,
};

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (_level, line) => lines.push(line) });
  const provider = createMockProvider({
    embedder: bagOfWordsEmbedding,
    // Mistral refuse le lot entier dès qu'une entrée pose problème.
    embedReject: (texts) =>
      texts.some((t) => t.includes(POISON))
        ? new AiError("badRequest", { status: 400, providerType: "invalid_request_error" })
        : undefined,
  });
  const client = createAiClient({ provider, logger, sleep: async () => {}, backoffMs: 0 });
  return { lines, logger, provider, client };
}

const events = (lines: string[], event: string) =>
  lines.map((l) => JSON.parse(l) as Record<string, unknown>).filter((l) => l.event === event);

async function offerEmbeddingCount() {
  const [row] = await db.$queryRaw<{ count: bigint }[]>`
    SELECT count(*) FROM offer_embeddings WHERE offer_id LIKE ${`${run}-%`}`;
  return Number(row?.count);
}

describe.skipIf(!url)("matching : embeddings refusés isolés (#69)", { timeout: 60_000 }, () => {
  let userId: string;

  beforeAll(async () => {
    const now = new Date();
    await db.jobOffer.createMany({
      data: offers.map((o) => ({
        ...o,
        source: "test-matching-embeddings",
        sourceKey: `test-matching-embeddings:${run}`,
        sourceId: o.id,
        url: `https://emplois.exemple.test/${o.id}`,
        urlKey: `emplois.exemple.test/${o.id}`,
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: o.id,
      })),
    });
    const user = await db.user.create({ data: { email: `embed-${run}@exemple.test` } });
    userId = user.id;
    const skills = await Promise.all(
      ["Python", "SQL", "Airflow"].map((name) =>
        db.skill.create({ data: { userId, name, nameKey: name.toLowerCase() } }),
      ),
    );
    await db.achievement.create({
      data: {
        userId,
        title: "Refonte des pipelines de données",
        actions: "Migration des traitements Python et SQL vers Airflow",
        evidenceLevel: "DOCUMENT",
        skills: { create: skills.map((s) => ({ skillId: s.id })) },
      },
    });
    const { locations, excludedCompanies, ...data } = RAILS;
    void locations;
    void excludedCompanies;
    await db.guardRails.create({ data: { userId, ...data } });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: `embed-${run}@exemple.test` } });
    await db.jobOffer.deleteMany({ where: { id: { startsWith: run } } });
    await db.$disconnect();
  });

  it("un 400 sur un lot de 32 : 31 vecteurs, l'offre fautive ignorée et journalisée, semantic: true", async () => {
    const { lines, logger, provider, client } = setup();
    const result = await recomputeUserMatches(db, userId, {
      config,
      client,
      llmBudget: { remaining: 0 },
      logger,
    });
    // La base de test peut contenir d'autres offres : on ne regarde que les nôtres.
    expect(result).toMatchObject({ status: "done", semantic: true });
    expect(events(lines, "matching.embeddings.unavailable")).toEqual([]);

    // Les 32 offres non vides sont envoyées (la fautive refusée), jamais l'offre vide.
    const mine = provider.embedCalls.flat().filter((t) => t.includes(run));
    expect(new Set(mine).size).toBe(32);
    expect(provider.embedCalls.flat().some((t) => t.trim() === "")).toBe(false);

    expect(await offerEmbeddingCount()).toBe(31);
    const stored = await db.offerEmbedding.findMany({
      where: { offerId: { in: [poisoned.id, `${run}-vide`] } },
    });
    expect(stored).toEqual([]);
    const rejection = await db.offerEmbeddingRejection.findUniqueOrThrow({
      where: { offerId: poisoned.id },
    });
    expect(rejection.textHash).toBe(textHash(offerEmbeddingText(poisoned)));
    expect(await db.offerEmbeddingRejection.count({ where: { offerId: `${run}-vide` } })).toBe(0);

    // Toutes les offres sont notées, y compris la fautive (sans similarité).
    expect(await db.match.count({ where: { userId, offerId: { startsWith: run } } })).toBe(33);

    const [failed] = events(lines, "ai.embed.failed");
    expect(failed).toMatchObject({
      purpose: "matching.offers",
      code: "badRequest",
      status: 400,
      emptyInputs: 0,
      providerType: "invalid_request_error",
    });
    expect(failed!.entries).toBeGreaterThan(1);
    expect(failed!.estTok).toBeGreaterThan(0);
    expect(failed!.maxEntryTok).toBeGreaterThan(0);
    expect(events(lines, "matching.embeddings.rejected")).toEqual([
      expect.objectContaining({
        offerId: poisoned.id,
        chars: offerEmbeddingText(poisoned).length,
      }),
    ]);
    // Aucun texte d'offre ni de la mémoire dans les journaux.
    for (const line of lines) {
      expect(line).not.toContain("POISON");
      expect(line).not.toContain("Senior Data");
      expect(line).not.toContain("Airflow");
    }
  });

  it("l'offre refusée n'est pas renvoyée au cycle suivant, tant que son texte ne change pas", async () => {
    const first = setup();
    const again = await recomputeUserMatches(db, userId, {
      config,
      client: first.client,
      llmBudget: { remaining: 0 },
      logger: first.logger,
    });
    expect(again).toMatchObject({ status: "done", semantic: true });
    expect(first.provider.embedCalls.flat().filter((t) => t.includes(run))).toEqual([]);

    await db.jobOffer.update({
      where: { id: poisoned.id },
      data: { description: great.description },
    });
    const second = setup();
    await recomputeUserMatches(db, userId, {
      config,
      client: second.client,
      llmBudget: { remaining: 0 },
      logger: second.logger,
    });
    expect(second.provider.embedCalls.flat().filter((t) => t.includes(run))).toEqual([
      offerEmbeddingText({ title: poisoned.title, description: great.description }),
    ]);
    expect(await offerEmbeddingCount()).toBe(32);
  });
});
