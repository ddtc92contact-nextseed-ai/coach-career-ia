import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * La pertinence d'abord (issue #72), de bout en bout : fournisseur simulé
 * dont les vecteurs reproduisent les cosinus mesurés en prod avec
 * mistral-embed, distribution calculée par PostgreSQL, puis classement.
 */

const { PrismaClient } = await import("@/generated/prisma/client");
const { PrismaPg } = await import("@prisma/adapter-pg");
const { createAiClient, createMockProvider } = await import("@/lib/ai");
const { createLogger } = await import("@/lib/logger");
const { matchingConfig } = await import("@/lib/matching/config");
const { parseExplanation } = await import("@/lib/matching/explanation");
const { recomputeUserMatches } = await import("@/lib/matching/recompute");
const { AV_OFFERS, AV_PROFILE, AV_RAILS, avSimilarities, BACKGROUND_OFFERS, OFF_TOPIC_OFFERS } =
  await import("../fixtures/matching/audiovisual");

const url = process.env.TEST_DATABASE_URL;
const db = new PrismaClient({
  adapter: new PrismaPg({ connectionString: url ?? "postgresql://absent/absent" }),
});
const run = `r${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const id = (fixtureId: string) => `${run}-${fixtureId}`;
const offers = [...AV_OFFERS, ...OFF_TOPIC_OFFERS, ...BACKGROUND_OFFERS];

/**
 * Vecteurs sur mesure : mémoire m_i = a·g + b·e_i, offre v = α·g + Σ β_i·e_i
 * + γ·r (bases orthonormées), donc cos(v, m_i) = a·α + b·β_i : chaque
 * similarité offre ↔ élément est fixée à la main. Texte inconnu (offre
 * d'un autre test) : à la médiane.
 */
const A = 0.8;
const B = 0.6;
const ALPHA = 0.85;
const MEMORY_TITLES = [
  AV_PROFILE.achievements[0]!.title,
  ...(AV_PROFILE.experiences ?? []).map((e) => e.title),
];
const MEMORY_IDS = ["av-achievement", ...(AV_PROFILE.experiences ?? []).map((e) => e.id)];
const similarities = avSimilarities();
const byTitle = new Map(offers.map((o) => [o.title, similarities.get(o.id)!]));

function embedder(text: string): number[] {
  const firstLine = text.split("\n")[0]!.trim();
  const memory = MEMORY_TITLES.indexOf(firstLine);
  if (memory >= 0) {
    return [A, ...MEMORY_IDS.map((_, k) => (k === memory ? B : 0)), 0];
  }
  const sims = byTitle.get(firstLine);
  const betas = MEMORY_IDS.map((m) => ((sims?.get(m) ?? A * ALPHA) - A * ALPHA) / B);
  const rest = 1 - ALPHA ** 2 - betas.reduce((n, b) => n + b * b, 0);
  return [ALPHA, ...betas, Math.sqrt(Math.max(0, rest))];
}

const config = { ...matchingConfig({}), llmExplanations: false };

function setup() {
  const lines: string[] = [];
  const logger = createLogger({ level: "debug", write: (_level, line) => lines.push(line) });
  const mock = createMockProvider({ embedder });
  // Modèle propre à ce test : jamais comparé aux vecteurs d'autres tests.
  const provider = { ...mock, embeddingModel: `mock-av-${run}` };
  const client = createAiClient({ provider, logger, sleep: async () => {}, backoffMs: 0 });
  return { lines, logger, provider: mock, client };
}

describe.skipIf(!url)("matching : la pertinence d'abord (#72)", { timeout: 120_000 }, () => {
  let userId: string;

  beforeAll(async () => {
    const now = new Date();
    await db.jobOffer.createMany({
      data: offers.map((o) => ({
        ...o,
        id: id(o.id),
        companyId: undefined,
        source: "test-matching-relevance",
        sourceKey: `test-matching-relevance:${run}`,
        sourceId: id(o.id),
        url: `https://emplois.exemple.test/${id(o.id)}`,
        urlKey: `emplois.exemple.test/${id(o.id)}`,
        firstSeenAt: now,
        lastSeenAt: now,
        contentHash: id(o.id),
      })),
    });
    const user = await db.user.create({ data: { email: `relevance-${run}@exemple.test` } });
    userId = user.id;
    for (const [k, e] of (AV_PROFILE.experiences ?? []).entries()) {
      await db.experience.create({
        data: {
          userId,
          roleTitle: e.title,
          responsibilities: e.responsibilities,
          startMonth: new Date(Date.UTC(1998 + 2 * k, 0, 1)),
          endMonth: new Date(Date.UTC(1999 + 2 * k, 11, 1)),
          seniority: "MID",
          contractType: "CDI",
          sector: "MEDIA_ENTERTAINMENT",
          companySize: "S201_500",
          companyStage: "SCALEUP",
        },
      });
    }
    const [skillName] = AV_PROFILE.achievements[0]!.skills;
    const skill = await db.skill.create({
      data: { userId, name: skillName!, nameKey: skillName!.toLowerCase() },
    });
    await db.achievement.create({
      data: {
        userId,
        title: AV_PROFILE.achievements[0]!.title,
        actions: "Mélangeur, grille d'antenne, contrôle des signaux.",
        evidenceLevel: "DECLARED",
        skills: { create: [{ skillId: skill.id }] },
      },
    });
    const { locations, excludedCompanies, ...data } = AV_RAILS;
    void locations;
    void excludedCompanies;
    await db.guardRails.create({ data: { userId, ...data } });
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { email: `relevance-${run}@exemple.test` } });
    await db.jobOffer.deleteMany({ where: { id: { startsWith: run } } });
    await db.$disconnect();
  });

  async function scores() {
    const rows = await db.match.findMany({
      where: { userId, offerId: { startsWith: run } },
      orderBy: [{ score: "desc" }, { offerId: "asc" }],
    });
    return rows.map((r) => ({ ...r, fixture: r.offerId.slice(run.length + 1) }));
  }

  it("premier passage : offres pas encore embarquées, bornes fixes de repli", async () => {
    const { client, lines, logger } = setup();
    const result = await recomputeUserMatches(db, userId, {
      config,
      client,
      llmBudget: { remaining: 0 },
      logger,
    });
    expect(result).toMatchObject({ status: "done", semantic: true, calibrated: 0 });
    // Une entrée par réalisation ET par expérience.
    expect(await db.memoryEmbedding.count({ where: { userId } })).toBe(4);
    for (const line of lines) {
      expect(line).not.toContain("Technicien");
      expect(line).not.toContain("régie");
    }
  });

  it("passage suivant : similarité calibrée en SQL, les offres du métier sans salaire en tête", async () => {
    const { client, provider } = setup();
    const result = await recomputeUserMatches(db, userId, {
      config,
      client,
      llmBudget: { remaining: 0 },
    });
    expect(result).toMatchObject({ status: "done", semantic: true, calibrated: 4 });
    // Rien n'est ré-embarqué : seules les similarités sont relues.
    expect(provider.embedCalls).toEqual([]);

    const stored = await scores();
    const mine = stored.filter((m) => !m.fixture.startsWith("bg-"));
    expect(
      mine
        .slice(0, 3)
        .map((m) => m.fixture)
        .sort(),
    ).toEqual(AV_OFFERS.map((o) => o.id).sort());
    const av = mine.filter((m) => m.fixture.startsWith("av-"));
    const offTopic = mine.filter((m) => m.fixture.startsWith("off-"));
    const bestOffTopic = Math.max(0, ...offTopic.map((m) => m.score));
    expect(Math.min(...av.map((m) => m.score)) - bestOffTopic).toBeGreaterThanOrEqual(15);
    // La plupart des offres hors sujet ne sont même plus conservées.
    expect(offTopic.length).toBeLessThanOrEqual(5);

    const explanation = parseExplanation(av[0]!.explanation)!;
    expect(explanation.experiences?.length).toBeGreaterThan(0);
    expect(explanation.unknowns).toContain("salaryNotStated");
    expect(explanation.gaps.map((g) => g.code)).not.toContain("lowRelevance");
  });
});
