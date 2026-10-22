import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

// Base de test : le code applicatif est exécuté tel quel.
vi.mock("@/lib/db", async () => {
  const { PrismaClient } = await import("@/generated/prisma/client");
  const { PrismaPg } = await import("@prisma/adapter-pg");
  const connectionString = process.env.TEST_DATABASE_URL ?? "postgresql://absent/absent";
  return { db: new PrismaClient({ adapter: new PrismaPg({ connectionString }) }) };
});

const { db } = await import("@/lib/db");
const repo = await import("@/lib/career/repository");
const { recomputeUserMatches } = await import("@/lib/matching/recompute");
const { matchingConfig } = await import("@/lib/matching/config");
const { mapGreenhouseJob } = await import("@/lib/radar/connectors/greenhouse");
const { reclassifyRemotePolicies } = await import("@/lib/radar/reclassify");
const { detectRemotePolicy } = await import("@/lib/radar/normalize");
const { createLogger } = await import("@/lib/logger");
const { company, fixtureJson } = await import("../helpers/radar");
type GreenhouseJob = import("@/lib/radar/connectors/greenhouse").GreenhouseJob;

const url = process.env.TEST_DATABASE_URL;
const run = `rc${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
const silent = createLogger({ write: () => {} });

/** Géocodage simulé des garde-fous : deux communes d'Alsace. */
const ALSACE: Record<string, { latitude: number; longitude: number }> = {
  Strasbourg: { latitude: 48.5734, longitude: 7.7521 },
  Colmar: { latitude: 48.0794, longitude: 7.3585 },
};
const locate = async (labels: string[]) => labels.map((l) => ALSACE[l] ?? null);

const recompute = (userId: string) =>
  recomputeUserMatches(db, userId, {
    config: matchingConfig({}),
    client: null,
    llmBudget: { remaining: 0 },
    logger: silent,
  });

describe.skipIf(!url)("reclassement du télétravail des offres déjà en base", () => {
  let userId: string;
  const doctolibId = `${run}-doctolib`;
  const structuredId = `${run}-structured`;
  const directId = `${run}-direct`;
  // Lue comme négative par la détection (« pas » juste avant) : seule l'origine protège l'offre.
  const directDescription = "Pas de déménagement à prévoir : poste en full remote.";

  beforeAll(async () => {
    process.env.DATA_ENCRYPTION_KEY ??= randomBytes(32).toString("base64");
    const user = await db.user.create({ data: { email: `alsace-${run}@exemple.test` } });
    userId = user.id;
    await repo.createExperience(userId, {
      roleTitle: "Commerciale sédentaire",
      startMonth: "2020-01",
      endMonth: undefined,
      seniority: "MID",
      contractType: "CDI",
      sector: "SAAS_SOFTWARE",
      companySize: "S201_500",
      companyStage: "SCALEUP",
      responsibilities: "Prospection téléphonique et cycle de vente complet",
    });
    await repo.addDeclaredSkill(userId, "Prospection");
    // Zone limitée à l'Alsace, aucune préférence de télétravail.
    await repo.saveGuardRails(
      userId,
      {
        minRemoteDays: undefined,
        contractTypes: [],
        excludedSectors: [],
        excludedCompanies: [],
        acceptsOnCall: true,
        culturePreferences: [],
        locations: [
          { label: "Strasbourg", radiusKm: 30 },
          { label: "Colmar", radiusKm: 30 },
        ],
      },
      locate,
    );

    const [job] = fixtureJson<{ jobs: GreenhouseJob[] }>("greenhouse-doctolib.json").jobs;
    const mapped = mapGreenhouseJob(
      job!,
      company({ slug: "doctolib", name: "Doctolib", boardToken: "doctolib" }),
    )!;
    const now = new Date();
    const base = {
      source: "test-reclassify",
      sourceKey: `test-reclassify:${run}`,
      companyName: "Doctolib",
      country: "FR",
      contractType: "CDI" as const,
      firstSeenAt: now,
      lastSeenAt: now,
      contentHash: "avant",
    };
    await db.jobOffer.createMany({
      data: [
        {
          // Classée avant le correctif d'après « vous recherchez un poste 100 % en télétravail ».
          ...base,
          id: doctolibId,
          sourceId: doctolibId,
          url: mapped.url,
          urlKey: `${run}/doctolib`,
          title: mapped.title,
          description: mapped.description,
          city: "Nantes",
          latitude: 47.2184,
          longitude: -1.5536,
          remotePolicy: "FULL_REMOTE",
        },
        {
          // Télétravail complet donné par l'ATS (lieu « Remote ») : le texte n'en parle pas.
          ...base,
          id: structuredId,
          sourceId: structuredId,
          url: `https://emplois.exemple.test/${run}/structured`,
          urlKey: `${run}/structured`,
          title: "Commercial(e) sédentaire",
          description: "Prospection téléphonique auprès des professionnels de santé.",
          city: null,
          remotePolicy: "FULL_REMOTE",
        },
        {
          // Offre publiée par un employeur : politique choisie, jamais recollectée.
          ...base,
          source: "direct",
          sourceKey: `direct:${run}`,
          id: directId,
          sourceId: directId,
          url: `https://emplois.exemple.test/${run}/direct`,
          urlKey: `${run}/direct`,
          title: "Commercial(e) sédentaire",
          description: directDescription,
          city: "Nantes",
          remotePolicy: "FULL_REMOTE",
        },
      ],
    });
    // Opportunité sauvegardée par la candidate, proposée avant le correctif.
    await db.match.create({
      data: {
        userId,
        offerId: doctolibId,
        score: 70,
        explanation: {},
        inputHash: "avant",
        status: "SAVED",
        computedAt: now,
      },
    });
  });

  afterAll(async () => {
    if (userId) await db.user.deleteMany({ where: { id: userId } });
    await db.jobOffer.deleteMany({ where: { id: { startsWith: run } } });
    await db.$disconnect();
  });

  it("mal classée en télétravail complet, l'offre de Nantes contourne le filtre de distance", async () => {
    expect(await recompute(userId)).toMatchObject({ status: "done" });
    const saved = await db.match.findMany({ where: { userId, offerId: doctolibId } });
    expect(saved).toHaveLength(1);
  });

  it("reclasse l'offre depuis son texte et demande le recalcul des candidats", async () => {
    await db.matchingState.deleteMany({ where: { userId } });
    const summary = await reclassifyRemotePolicies(db, { logger: silent });
    expect(summary.reclassified).toBeGreaterThanOrEqual(1);
    expect(summary.candidates).toBeGreaterThanOrEqual(1);

    const doctolib = await db.jobOffer.findUniqueOrThrow({ where: { id: doctolibId } });
    expect(doctolib.remotePolicy).toBe("HYBRID");
    // Empreinte effacée : le passage suivant du radar réécrit l'offre depuis sa source.
    expect(doctolib.contentHash).toBe("");
    // Indicateur structuré (aucune mention dans le texte) : inchangé.
    const structured = await db.jobOffer.findUniqueOrThrow({ where: { id: structuredId } });
    expect(structured).toMatchObject({ remotePolicy: "FULL_REMOTE", contentHash: "avant" });
    // Offre directe : le choix de l'employeur et l'empreinte restent intacts.
    expect(detectRemotePolicy("Commercial(e) sédentaire", directDescription)).toBe("UNKNOWN");
    const direct = await db.jobOffer.findUniqueOrThrow({ where: { id: directId } });
    expect(direct).toMatchObject({ remotePolicy: "FULL_REMOTE", contentHash: "avant" });

    const state = await db.matchingState.findUniqueOrThrow({ where: { userId } });
    expect(state.dirtyAt).toBeInstanceOf(Date);
  });

  it("après le recalcul, l'opportunité hors zone a disparu", async () => {
    const result = await recompute(userId);
    expect(result).toMatchObject({ status: "done" });
    expect(await db.match.count({ where: { userId, offerId: doctolibId } })).toBe(0);
  });

  it("idempotent : un second passage ne reclasse rien", async () => {
    const summary = await reclassifyRemotePolicies(db, { logger: silent });
    expect(summary.reclassified).toBe(0);
    expect((await db.jobOffer.findUniqueOrThrow({ where: { id: doctolibId } })).remotePolicy).toBe(
      "HYBRID",
    );
  });
});
