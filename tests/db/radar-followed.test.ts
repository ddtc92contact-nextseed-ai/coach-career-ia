import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { loadCompanyConfig, loadWatchedCompanies, syncCompanies } from "@/lib/radar/companies";
import type { RadarConfig } from "@/lib/radar/config";
import {
  MAX_FOLLOWED,
  exportFollowedCompanies,
  followByUrl,
  followCompany,
  listFollowedCompanies,
  searchCompanies,
  unfollowCompany,
} from "@/lib/radar/followed";
import { runRadar } from "@/lib/radar/job";
import {
  TEST_USER_AGENT,
  fakeFetch,
  fixture,
  jsonResponse,
  noSleep,
  testHttp,
} from "../helpers/radar";

const url = process.env.TEST_DATABASE_URL;
const silent = createLogger({ write: () => {} });
const run = Date.now().toString(36);
const configFile = fileURLToPath(
  new URL("../fixtures/radar/companies-followed.json", import.meta.url),
);

/** Boards servis depuis les fixtures : Greenhouse (dataiku) et Lever (qonto). */
function boards() {
  return fakeFetch((input) => {
    if (input.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /v/");
    if (input.startsWith("https://boards-api.greenhouse.io/v1/boards/dataiku/jobs")) {
      return jsonResponse(fixture("greenhouse-dataiku.json"));
    }
    if (input.startsWith("https://api.lever.co/v0/postings/qonto")) {
      return jsonResponse(fixture("lever-qonto.json"));
    }
    return new Response("not found", { status: 404 });
  });
}

const config = (): RadarConfig => ({
  databaseUrl: url!,
  userAgent: TEST_USER_AGENT,
  intervalHours: 6,
  runOnStart: true,
  countries: [],
  companiesFile: configFile,
  minIntervalMs: 1000,
  franceTravail: null,
});

describe.skipIf(!url)("« Mes entreprises à suivre » (radar)", () => {
  let prisma: PrismaClient;
  const created: string[] = [];
  const newUser = async (label: string) => {
    const user = await prisma.user.create({
      data: { email: `${label}-${run}-${Math.random()}@exemple.test` },
    });
    created.push(user.id);
    return user;
  };

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  beforeEach(async () => {
    await prisma.jobOffer.deleteMany({});
    await prisma.sourceRun.deleteMany({});
    await prisma.radarPass.deleteMany({});
    await prisma.company.deleteMany({});
  });

  afterAll(async () => {
    // Suivre une entreprise marque le candidat « à recalculer » : rien ne doit
    // rester en attente pour les autres suites (cycle de matching).
    await prisma?.user.deleteMany({ where: { id: { in: created } } });
    await prisma?.$disconnect();
  });

  it("URL prise en charge : ATS détecté, validé sur la fixture, collecté au passage suivant", async () => {
    await syncCompanies(prisma, await loadCompanyConfig(configFile));
    const [alice, bob] = [await newUser("alice"), await newUser("bob")];

    const probe = boards();
    const added = await followByUrl(prisma, alice.id, "https://jobs.lever.co/qonto", {
      http: testHttp(probe),
    });
    expect(added).toMatchObject({ ok: true, alreadyFollowed: false });
    if (!added.ok) return;
    expect(added.openOffers).toBe((JSON.parse(fixture("lever-qonto.json")) as unknown[]).length);
    expect(probe.calls.map((c) => c.url)).toEqual([
      "https://api.lever.co/v0/postings/qonto?mode=json",
    ]);
    expect(
      await prisma.company.findUniqueOrThrow({ where: { id: added.companyId } }),
    ).toMatchObject({
      atsType: "LEVER",
      boardToken: "qonto",
      origin: "USER",
      active: true,
      slug: "lever-qonto",
    });

    // Deuxième abonné : board déjà connu, aucune requête, même entreprise.
    const again = fakeFetch(() => new Response("inattendu", { status: 500 }));
    const second = await followByUrl(prisma, bob.id, "jobs.lever.co/QONTO/", {
      http: testHttp(again),
    });
    expect(second).toMatchObject({ ok: true, companyId: added.companyId });
    expect(again.calls).toHaveLength(0);
    expect(await prisma.company.count({ where: { atsType: "LEVER" } })).toBe(1);

    // Passage du radar : un seul fetch par board, quel que soit le nombre d'abonnés.
    const radar = boards();
    const summaries = await runRadar(prisma, config(), {
      fetch: radar,
      sleep: noSleep,
      logger: silent,
      now: () => new Date("2026-10-21T06:00:00Z"),
      geocoder: null,
    });
    expect(summaries.map((s) => [s.sourceKey, s.status])).toEqual([
      ["greenhouse:dataiku", "SUCCESS"],
      ["lever:lever-qonto", "SUCCESS"],
    ]);
    const apiCalls = radar.calls.map((c) => c.url).filter((u) => !u.endsWith("/robots.txt"));
    expect(apiCalls.filter((u) => u.includes("lever.co"))).toHaveLength(1);
    const offers = await prisma.jobOffer.count({ where: { companyId: added.companyId } });
    expect(offers).toBeGreaterThan(0);

    // Deuxième passage : pas de doublon.
    await runRadar(prisma, config(), {
      fetch: boards(),
      sleep: noSleep,
      logger: silent,
      now: () => new Date("2026-10-21T12:00:00Z"),
      geocoder: null,
    });
    expect(await prisma.jobOffer.count({ where: { companyId: added.companyId } })).toBe(offers);

    const list = await listFollowedCompanies(prisma, alice.id, null);
    expect(list).toEqual([
      expect.objectContaining({ name: added.name, status: "ok", openOffers: offers }),
    ]);
  });

  it("une entreprise délaissée par tous n'est plus collectée", async () => {
    const user = await newUser("carole");
    const added = await followByUrl(prisma, user.id, "https://jobs.lever.co/qonto", {
      http: testHttp(boards()),
    });
    if (!added.ok) throw new Error("ajout refusé");
    expect((await loadWatchedCompanies(prisma)).map((c) => c.boardToken)).toContain("qonto");
    await unfollowCompany(prisma, user.id, added.companyId);
    expect((await loadWatchedCompanies(prisma)).map((c) => c.boardToken)).not.toContain("qonto");
  });

  it("site non pris en charge, board introuvable, limite de validations : aucune entreprise créée", async () => {
    const user = await newUser("denis");
    const fetch = boards();
    const deps = { http: testHttp(fetch) };
    expect(
      await followByUrl(prisma, user.id, "https://www.welcometothejungle.com/fr/companies/x", deps),
    ).toEqual({ ok: false, error: "unsupported" });
    expect(await followByUrl(prisma, user.id, "Qonto", deps)).toEqual({
      ok: false,
      error: "invalidUrl",
    });
    expect(fetch.calls).toHaveLength(0);
    expect(await followByUrl(prisma, user.id, "https://jobs.lever.co/inconnue", deps)).toEqual({
      ok: false,
      error: "notFound",
    });
    expect(
      await followByUrl(prisma, user.id, "https://jobs.ashbyhq.com/alan", {
        ...deps,
        allowProbe: () => false,
      }),
    ).toEqual({ ok: false, error: "rateLimited" });
    expect(await prisma.company.count()).toBe(0);
  });

  it(`au plus ${MAX_FOLLOWED} entreprises suivies`, async () => {
    const user = await newUser("eve");
    await prisma.company.createMany({
      data: Array.from({ length: MAX_FOLLOWED }, (_, i) => ({
        slug: `limite-${i}`,
        name: `Limite ${i}`,
        atsType: "GREENHOUSE" as const,
        boardToken: `limite-${i}`,
      })),
    });
    const ids = (await prisma.company.findMany({ select: { id: true } })).map((c) => c.id);
    await prisma.followedCompany.createMany({
      data: ids.map((companyId) => ({ userId: user.id, companyId })),
    });
    const fetch = boards();
    expect(
      await followByUrl(prisma, user.id, "https://jobs.lever.co/qonto", { http: testHttp(fetch) }),
    ).toEqual({ ok: false, error: "limit" });
    expect(fetch.calls).toHaveLength(0);
    // Déjà suivie : pas concernée par la limite.
    expect(await followCompany(prisma, user.id, ids[0]!)).toMatchObject({
      ok: true,
      alreadyFollowed: true,
    });
  });

  it("recherche par nom, garde-fous signalés, export et suppression du compte", async () => {
    await syncCompanies(prisma, await loadCompanyConfig(configFile));
    const user = await newUser("fanny");
    const other = await newUser("gaston");
    const [found] = await searchCompanies(prisma, user.id, "datai");
    expect(found).toMatchObject({ name: "Dataiku", followed: false });
    expect(await followCompany(prisma, user.id, found!.id)).toMatchObject({ ok: true });
    expect((await searchCompanies(prisma, user.id, "datai"))[0]?.followed).toBe(true);
    // L'autre candidat ne voit pas ce suivi.
    expect((await searchCompanies(prisma, other.id, "datai"))[0]?.followed).toBe(false);
    expect(await listFollowedCompanies(prisma, other.id, null)).toEqual([]);

    const [view] = await listFollowedCompanies(prisma, user.id, {
      excludedCompanies: ["DATAIKU SAS"],
      excludedSectors: [],
    });
    expect(view).toMatchObject({ name: "Dataiku", status: "waiting", excludedBy: "company" });

    expect(await exportFollowedCompanies(prisma, user.id)).toEqual([
      expect.objectContaining({ name: "Dataiku", ats: "GREENHOUSE", boardToken: "dataiku" }),
    ]);

    await prisma.user.delete({ where: { id: user.id } });
    expect(await prisma.followedCompany.count({ where: { userId: user.id } })).toBe(0);
    // L'entreprise, partagée, reste surveillée.
    expect(await prisma.company.count({ where: { id: found!.id } })).toBe(1);
  });

  it("liste de référence : un board ajouté par un candidat y est rattaché, un retrait suivi reste surveillé", async () => {
    const user = await newUser("hugo");
    const added = await followByUrl(prisma, user.id, "https://boards.greenhouse.io/dataiku", {
      http: testHttp(boards()),
    });
    if (!added.ok) throw new Error("ajout refusé");
    await syncCompanies(prisma, await loadCompanyConfig(configFile));
    expect(
      await prisma.company.findUniqueOrThrow({ where: { id: added.companyId } }),
    ).toMatchObject({ slug: "dataiku", origin: "CONFIG" });

    await syncCompanies(prisma, []);
    expect(
      await prisma.company.findUniqueOrThrow({ where: { id: added.companyId } }),
    ).toMatchObject({ origin: "USER", active: true });
    await unfollowCompany(prisma, user.id, added.companyId);
    expect(await loadWatchedCompanies(prisma)).toEqual([]);
  });
});
