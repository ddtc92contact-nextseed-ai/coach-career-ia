import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Base de test et session simulée : le code applicatif est exécuté tel quel.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});
vi.mock("@/lib/auth/session", () => ({ getCurrentUser: vi.fn(), requireUser: vi.fn() }));
// Géocodage simulé : « Paris » est connue, le reste introuvable.
vi.mock("@/lib/geo/server", () => ({
  locateLabels: vi.fn(async (labels: string[]) =>
    labels.map((l) => (l === "Paris" ? { latitude: 48.8566, longitude: 2.3522 } : null)),
  ),
}));

const { db } = await import("@/lib/db");
const { requireUser } = await import("@/lib/auth/session");
const { AiError, createAiClient, createMockProvider } = await import("@/lib/ai");
const repo = await import("@/lib/career/repository");
const matching = await import("@/lib/matching/repository");
const { recomputeUserMatches } = await import("@/lib/matching/recompute");
const { markAllCandidatesDirty, runMatchingCycle } = await import("@/lib/matching/jobs");
const { runAlerts, unsubscribeAlerts } = await import("@/lib/matching/alerts");
const { parseExplanation } = await import("@/lib/matching/explanation");
const { matchingConfig } = await import("@/lib/matching/config");
const { POST: oneClickUnsubscribe } = await import("@/app/api/alerts/unsubscribe/route");
const { default: OpportunityPage } = await import("@/app/[locale]/app/opportunites/[id]/page");
const { OFFERS } = await import("../fixtures/matching/cases");
const { BAG_OF_WORDS_RANGE, bagOfWordsEmbedding } = await import("../helpers/matching");

const url = process.env.TEST_DATABASE_URL;
const run = `m${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const id = (fixtureId: string) => `${run}-${fixtureId}`;

const EXCLUDED = [
  "de-low-salary",
  "de-freelance",
  "de-lyon",
  "de-unlocated",
  "de-onsite",
  "de-one-day",
  "de-gambling",
  "de-globex",
  "de-hours",
  "de-on-call",
];

const config = {
  ...matchingConfig({}),
  debounceMs: 30_000,
  semanticRange: BAG_OF_WORDS_RANGE,
};

function mockClient(options: { llmDown?: boolean; embedDown?: boolean } = {}) {
  const provider = createMockProvider({
    embedder: bagOfWordsEmbedding,
    embedError: options.embedDown ? new AiError("unavailable") : undefined,
    respond: () =>
      options.llmDown
        ? { error: new AiError("unavailable") }
        : JSON.stringify({
            summary: "Votre réalisation sur les pipelines répond aux attentes du poste.",
          }),
  });
  return { provider, client: createAiClient({ provider, sleep: async () => {}, backoffMs: 0 }) };
}

async function newUser(label: string, locale = "fr") {
  return db.user.create({
    data: { email: `${label}-${run}@exemple.test`, locale },
  });
}

const guardRails = (overrides: Record<string, unknown> = {}) => ({
  minFixedSalary: 55000,
  targetTotalPackage: 65000,
  remotePolicy: "HYBRID" as const,
  minRemoteDays: 2,
  contractTypes: ["CDI" as const],
  excludedSectors: ["GAMBLING" as const],
  excludedCompanies: ["Globex"],
  maxWeeklyHours: 39,
  acceptsOnCall: false,
  culturePreferences: ["ASYNC_FIRST" as const, "LEARNING_CULTURE" as const],
  locations: [{ label: "Paris", radiusKm: 30 }],
  ...overrides,
});

async function myMatches(userId: string) {
  const rows = await db.match.findMany({
    where: { userId, offerId: { startsWith: run } },
    orderBy: { score: "desc" },
  });
  return rows.map((r) => ({ ...r, fixture: r.offerId.slice(run.length + 1) }));
}

describe.skipIf(!url)("matching : recalcul, stockage, isolation, alertes", () => {
  let alice: { id: string; email: string };
  let bob: { id: string; email: string };

  beforeAll(async () => {
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    alice = await newUser("alice");
    bob = await newUser("bob");

    const now = new Date();
    for (const offer of OFFERS) {
      await db.jobOffer.create({
        data: {
          id: id(offer.id),
          source: "test-matching",
          sourceKey: `test-matching:${run}`,
          sourceId: id(offer.id),
          url: `https://emplois.exemple.test/${offer.id}`,
          urlKey: `emplois.exemple.test/${run}/${offer.id}`,
          title: offer.title,
          description: offer.description,
          companyName: offer.companyName,
          sector: offer.sector,
          city: "Paris",
          country: "FR",
          latitude: offer.latitude,
          longitude: offer.longitude,
          remotePolicy: offer.remotePolicy,
          contractType: offer.contractType,
          salaryMin: offer.salaryMin,
          salaryMax: offer.salaryMax,
          salaryCurrency: offer.salaryCurrency,
          salaryPeriod: offer.salaryPeriod,
          firstSeenAt: now,
          lastSeenAt: now,
          contentHash: offer.id,
        },
      });
    }

    const experience = await repo.createExperience(alice.id, {
      roleTitle: "Data engineer",
      startMonth: "2019-01",
      endMonth: undefined,
      seniority: "SENIOR",
      contractType: "CDI",
      sector: "SAAS_SOFTWARE",
      companySize: "S201_500",
      companyStage: "SCALEUP",
      responsibilities: "",
    });
    const achievement = await repo.createAchievement(alice.id, {
      title: "Refonte des pipelines de données",
      context: "Traitements fragiles",
      actions: "Migration des traitements Python et SQL vers Airflow",
      result: "Temps de calcul divisé par trois",
      skills: ["Python", "SQL", "Airflow"],
      experienceId: experience.id,
    });
    await repo.addTextProof(alice.id, achievement.id, {
      kind: "URL",
      url: "https://exemple.fr/etude",
    });
    await repo.addDeclaredSkill(alice.id, "dbt");
    await repo.saveGuardRails(alice.id, guardRails());
  });

  afterAll(async () => {
    await db.user.deleteMany({ where: { id: { in: [alice?.id, bob?.id].filter(Boolean) } } });
    await db.jobOffer.deleteMany({ where: { id: { startsWith: run } } });
    await db.$disconnect();
  });

  it("toute modification de la mémoire ou des garde-fous demande un recalcul", async () => {
    const state = await db.matchingState.findUnique({ where: { userId: alice.id } });
    expect(state?.dirtyAt).toBeInstanceOf(Date);
    // Rien n'est calculé tant que le worker n'est pas passé.
    expect(await myMatches(alice.id)).toEqual([]);
  });

  it("le worker attend la fin des modifications (debounce), puis recalcule", async () => {
    const { client } = mockClient();
    const state = await db.matchingState.findUniqueOrThrow({ where: { userId: alice.id } });
    const early = await runMatchingCycle(db, { config, client, now: () => state.dirtyAt! });
    expect(early.processed).toBe(0);

    const later = new Date(state.dirtyAt!.getTime() + 60_000);
    // D'autres candidats (autres tests) peuvent être en attente : on ne regarde qu'Alice.
    await db.matchingState.updateMany({
      where: { userId: { not: alice.id }, dirtyAt: { not: null } },
      data: { dirtyAt: null },
    });
    const done = await runMatchingCycle(db, { config, client, now: () => later });
    expect(done.processed).toBe(1);
    const after = await db.matchingState.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(after.dirtyAt).toBeNull();
    expect(after.computedAt).toEqual(later);
  });

  it("aucune offre qui viole un garde-fou n'est stockée ; chaque correspondance est expliquée", async () => {
    const matches = await myMatches(alice.id);
    const fixtures = matches.map((m) => m.fixture);
    expect(fixtures.slice(0, 2)).toEqual(["de-great", "de-monthly-ok"]);
    for (const excluded of EXCLUDED) expect(fixtures).not.toContain(excluded);
    expect(fixtures).not.toContain("frontend");
    for (const m of matches) {
      const explanation = parseExplanation(m.explanation);
      expect(explanation, m.fixture).not.toBeNull();
      expect(explanation!.summary.length).toBeGreaterThan(10);
      expect(m.status).toBe("NEW");
    }
    const best = parseExplanation(matches[0]!.explanation)!;
    expect(best.source).toBe("llm");
    expect(best.matches[0]).toMatchObject({
      achievement: "Refonte des pipelines de données",
      proven: true,
    });
  });

  it("embeddings stockés avec pgvector et réutilisés (aucun nouvel appel au fournisseur)", async () => {
    const [row] = await db.$queryRaw<{ count: bigint }[]>`
      SELECT count(*) FROM offer_embeddings WHERE offer_id LIKE ${`${run}-%`}`;
    expect(Number(row?.count)).toBeGreaterThan(0);
    const memory = await db.memoryEmbedding.count({ where: { userId: alice.id } });
    expect(memory).toBe(1);

    const { client, provider } = mockClient();
    const result = await recomputeUserMatches(db, alice.id, {
      config,
      client,
      llmBudget: { remaining: 10 },
    });
    expect(result).toMatchObject({ status: "done", semantic: true, stored: 0 });
    expect(provider.embedCalls.flat().filter((t) => t.includes("Senior Data Engineer"))).toEqual(
      [],
    );
    expect(provider.calls).toEqual([]);
  });

  it("IA indisponible : le recalcul aboutit, explications déterministes", async () => {
    await db.match.deleteMany({ where: { userId: alice.id } });
    // Embeddings du candidat à recalculer : l'appel au fournisseur échoue.
    await db.memoryEmbedding.deleteMany({ where: { userId: alice.id } });
    const { client } = mockClient({ llmDown: true, embedDown: true });
    const result = await recomputeUserMatches(db, alice.id, {
      config,
      client,
      llmBudget: { remaining: 10 },
    });
    expect(result).toMatchObject({ status: "done", semantic: false, llm: 0 });
    const matches = await myMatches(alice.id);
    expect(matches.map((m) => m.fixture)[0]).toBe("de-great");
    for (const m of matches) {
      expect(parseExplanation(m.explanation)).toMatchObject({ source: "rules", locale: "fr" });
    }
  });

  it("la page n'affiche jamais une offre devenue hors garde-fous, même avant le recalcul", async () => {
    const before = await matching.getOpportunities(alice.id, { status: "active", minScore: 0 });
    expect(before.items.map((m) => m.offer.id)).toContain(id("de-monthly-ok"));

    // Plancher relevé : « de-monthly-ok » (62 400 € max) ne le respecte plus.
    await repo.saveGuardRails(alice.id, guardRails({ minFixedSalary: 70000 }));
    const during = await matching.getOpportunities(alice.id, { status: "active", minScore: 0 });
    expect(during.pending).toBe(true);
    expect(during.items.map((m) => m.offer.id)).not.toContain(id("de-monthly-ok"));
    const stale = (await myMatches(alice.id)).find((m) => m.fixture === "de-monthly-ok")!;
    expect(await matching.getMatch(alice.id, stale.id)).toBeNull();

    await recomputeUserMatches(db, alice.id, { config, client: null, llmBudget: { remaining: 0 } });
    expect((await myMatches(alice.id)).map((m) => m.fixture)).not.toContain("de-monthly-ok");
    await repo.saveGuardRails(alice.id, guardRails());
    await recomputeUserMatches(db, alice.id, { config, client: null, llmBudget: { remaining: 0 } });
  });

  it("sauvegarder / écarter : le statut survit au recalcul", async () => {
    const [best] = await myMatches(alice.id);
    await matching.setMatchStatus(alice.id, best!.id, "SAVED");
    await recomputeUserMatches(db, alice.id, { config, client: null, llmBudget: { remaining: 0 } });
    expect((await db.match.findUniqueOrThrow({ where: { id: best!.id } })).status).toBe("SAVED");
    const saved = await matching.getOpportunities(alice.id, { status: "saved", minScore: 0 });
    expect(saved.items.map((m) => m.id)).toEqual([best!.id]);
    await matching.setMatchStatus(alice.id, best!.id, "SEEN");
  });

  it("un utilisateur ne peut jamais lire ni modifier les correspondances d'un autre (404)", async () => {
    const [best] = await myMatches(alice.id);
    expect(await matching.getMatch(bob.id, best!.id)).toBeNull();
    await expect(matching.setMatchStatus(bob.id, best!.id, "DISMISSED")).rejects.toThrow(
      repo.NotFoundError,
    );
    expect((await db.match.findUniqueOrThrow({ where: { id: best!.id } })).status).not.toBe(
      "DISMISSED",
    );
    const bobView = await matching.getOpportunities(bob.id, { status: "all", minScore: 0 });
    expect(bobView).toMatchObject({ blocker: "noMemory", items: [] });

    vi.mocked(requireUser).mockResolvedValue(bob);
    await expect(OpportunityPage({ params: Promise.resolve({ id: best!.id }) })).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
    );
  });

  it("alertes : résumé dans la langue du candidat, offres seulement, puis désabonnement", async () => {
    await db.user.update({ where: { id: alice.id }, data: { locale: "en" } });
    await matching.saveAlertSettings(alice.id, { frequency: "DAILY", minScore: 50 });
    // Recalcul en attente (garde-fous modifiés) : le résumé est reporté.
    await db.matchingState.update({ where: { userId: alice.id }, data: { dirtyAt: new Date() } });
    const none: unknown[] = [];
    await runAlerts(db, {
      send: async (m) => void none.push(m),
      appUrl: "https://coach.exemple.test",
    });
    expect(none.filter((m) => (m as { to: string }).to === alice.email)).toEqual([]);
    await db.matchingState.update({ where: { userId: alice.id }, data: { dirtyAt: null } });

    const sent: {
      to: string;
      subject: string;
      text: string;
      html: string;
      headers?: Record<string, string>;
    }[] = [];
    const send = async (message: (typeof sent)[number]) => {
      sent.push(message);
    };
    const now = new Date();
    expect(
      await runAlerts(db, { send, appUrl: "https://coach.exemple.test", now: () => now }),
    ).toBeGreaterThanOrEqual(1);
    const email = sent.find((m) => m.to === alice.email)!;
    expect(email.subject).toMatch(/new opportunit/);
    // Nouvelles uniquement : l'offre déjà consultée (test précédent) n'est pas renvoyée.
    expect(email.text).toContain("Data Engineer confirmé");
    expect(email.text).not.toContain("Senior Data Engineer");
    expect(email.text).toContain("https://coach.exemple.test/en/app/opportunites/");
    // Rien de la mémoire de carrière ni des garde-fous.
    for (const secret of ["Refonte des pipelines", "Globex", "Python"]) {
      expect(email.text).not.toContain(secret);
      expect(email.html).not.toContain(secret);
    }
    expect(email.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    const notified = await db.match.count({ where: { userId: alice.id, notifiedAt: now } });
    expect(notified).toBeGreaterThan(0);

    // Déjà envoyé aujourd'hui : rien de plus.
    sent.length = 0;
    await runAlerts(db, { send, appUrl: "https://coach.exemple.test", now: () => now });
    expect(sent.filter((m) => m.to === alice.email)).toEqual([]);

    const state = await db.matchingState.findUniqueOrThrow({ where: { userId: alice.id } });
    expect(state.alertToken).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(await unsubscribeAlerts(db, "jeton-inconnu-0000000000")).toBe(false);
    const response = await oneClickUnsubscribe(
      new Request(`https://coach.exemple.test/api/alerts/unsubscribe?token=${state.alertToken}`, {
        method: "POST",
      }),
    );
    expect(response.status).toBe(200);
    expect((await matching.getAlertSettings(alice.id)).frequency).toBe("OFF");
  });

  it("nouvelles offres : tous les candidats avec garde-fous sont marqués à recalculer", async () => {
    const marked = await markAllCandidatesDirty(db);
    expect(marked).toBeGreaterThanOrEqual(1);
    expect(
      (await db.matchingState.findUniqueOrThrow({ where: { userId: alice.id } })).dirtyAt,
    ).not.toBeNull();
  });

  it("suppression en cascade : offre puis compte", async () => {
    const [best] = await myMatches(alice.id);
    await db.jobOffer.delete({ where: { id: best!.offerId } });
    expect(await db.match.findUnique({ where: { id: best!.id } })).toBeNull();
    expect(await db.offerEmbedding.findUnique({ where: { offerId: best!.offerId } })).toBeNull();

    await repo.deleteAccount(alice.id);
    const where = { userId: alice.id };
    expect(
      await Promise.all([
        db.match.count({ where }),
        db.matchingState.count({ where }),
        db.memoryEmbedding.count({ where }),
      ]),
    ).toEqual([0, 0, 0]);
  });
});
