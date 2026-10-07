import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import { ashbyConnector } from "@/lib/radar/connectors/ashby";
import {
  FT_SEARCH_URL,
  FT_TOKEN_URL,
  franceTravailConnector,
} from "@/lib/radar/connectors/france-travail";
import { greenhouseConnector } from "@/lib/radar/connectors/greenhouse";
import { leverConnector } from "@/lib/radar/connectors/lever";
import type { RadarConfig } from "@/lib/radar/config";
import { runRadar } from "@/lib/radar/job";
import { runConnectors } from "@/lib/radar/pipeline";
import type { Connector } from "@/lib/radar/types";
import {
  TEST_USER_AGENT,
  company,
  fixture,
  jsonResponse,
  noSleep,
  testHttp,
} from "../helpers/radar";

const url = process.env.TEST_DATABASE_URL;
const silent = createLogger({ write: () => {} });

type Board = { jobs: { id: unknown }[] };

/** Fixtures servies par URL ; `drop` retire des offres pour simuler leur disparition. */
function fixtureFetch(options: { drop?: string[]; failFranceTravail?: boolean } = {}) {
  const drop = new Set(options.drop ?? []);
  const board = (name: string) => {
    const data = JSON.parse(fixture(name)) as Board | { id: unknown }[];
    if (Array.isArray(data)) return data.filter((j) => !drop.has(String(j.id)));
    return { ...data, jobs: data.jobs.filter((j) => !drop.has(String(j.id))) };
  };
  return async (input: string): Promise<Response> => {
    if (input.startsWith(FT_TOKEN_URL) || input.startsWith(FT_SEARCH_URL)) {
      if (options.failFranceTravail) return new Response("indisponible", { status: 500 });
      if (input.startsWith(FT_TOKEN_URL)) return jsonResponse(fixture("france-travail-token.json"));
      const offers = ["france-travail-page-1.json", "france-travail-page-2.json"].flatMap(
        (f) => (JSON.parse(fixture(f)) as { resultats: { id: string }[] }).resultats,
      );
      const kept = offers.filter((o) => !drop.has(o.id));
      return jsonResponse(
        { resultats: kept },
        { status: 206, headers: { "Content-Range": `offres 0-149/${kept.length}` } },
      );
    }
    if (input.includes("greenhouse.io")) return jsonResponse(board("greenhouse-dataiku.json"));
    if (input.includes("lever.co")) return jsonResponse(board("lever-qonto.json"));
    if (input.includes("ashbyhq.com")) return jsonResponse(board("ashby-alan.json"));
    return new Response("not found", { status: 404 });
  };
}

const dataiku = company({ slug: "dataiku", name: "Dataiku", boardToken: "dataiku" });
const qonto = company({ slug: "qonto", name: "Qonto", atsType: "LEVER", boardToken: "qonto" });
const alan = company({ slug: "alan", name: "Alan", atsType: "ASHBY", boardToken: "alan" });

function connectors(): Connector<unknown>[] {
  return [
    franceTravailConnector(
      { clientId: "id", clientSecret: "secret" },
      { romeCodes: [], keywords: null, departments: ["75"], maxResultsPerSearch: 150 },
    ),
    greenhouseConnector(dataiku),
    leverConnector(qonto),
    ashbyConnector(alan),
  ] as Connector<unknown>[];
}

describe.skipIf(!url)("Market Radar (pipeline en base)", () => {
  let prisma: PrismaClient;

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  beforeEach(async () => {
    // Base de test dédiée : on repart de tables radar vides pour chaque scénario.
    await prisma.jobOffer.deleteMany({});
    await prisma.sourceRun.deleteMany({});
    await prisma.company.deleteMany({});
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  const run = (at: string, options: Parameters<typeof fixtureFetch>[0] = {}) =>
    runConnectors(prisma, connectors(), {
      http: testHttp(fixtureFetch(options)),
      now: () => new Date(at),
      allowedCountries: ["FR"],
      logger: silent,
    });

  it("est idempotent : deux passages identiques ne créent aucun doublon", async () => {
    const first = await run("2026-10-07T06:00:00Z");
    expect(first.every((s) => s.status === "SUCCESS")).toBe(true);
    const total = await prisma.jobOffer.count();
    // 4 France Travail + 2 Greenhouse (offre US écartée) + 3 Lever + 3 Ashby.
    expect(total).toBe(12);
    expect(first.find((s) => s.sourceKey === "greenhouse:dataiku")).toMatchObject({
      fetched: 3,
      created: 2,
      skipped: 1,
    });

    const second = await run("2026-10-07T12:00:00Z");
    expect(await prisma.jobOffer.count()).toBe(total);
    expect(second.reduce((n, s) => n + s.created + s.updated + s.closed, 0)).toBe(0);
    expect(second.reduce((n, s) => n + s.unchanged, 0)).toBe(total);

    const offer = await prisma.jobOffer.findUniqueOrThrow({
      where: {
        source_sourceId: { source: "lever", sourceId: "ebed5dab-630c-48ea-be8f-9e018797c193" },
      },
    });
    expect(offer.firstSeenAt.toISOString()).toBe("2026-10-07T06:00:00.000Z");
    expect(offer.lastSeenAt.toISOString()).toBe("2026-10-07T12:00:00.000Z");
  });

  it("ferme une offre absente d'un passage complet, et la rouvre si elle revient", async () => {
    await run("2026-10-07T06:00:00Z");
    const summaries = await run("2026-10-07T12:00:00Z", { drop: ["6148066004", "201TSTD"] });
    expect(summaries.find((s) => s.sourceKey === "greenhouse:dataiku")!.closed).toBe(1);
    expect(summaries.find((s) => s.sourceKey === "france_travail")!.closed).toBe(1);

    const closed = await prisma.jobOffer.findUniqueOrThrow({
      where: { source_sourceId: { source: "greenhouse", sourceId: "6148066004" } },
    });
    expect(closed.status).toBe("CLOSED");
    expect(closed.closedAt?.toISOString()).toBe("2026-10-07T12:00:00.000Z");
    expect(await prisma.jobOffer.count({ where: { status: "OPEN" } })).toBe(10);

    await run("2026-10-07T18:00:00Z");
    const reopened = await prisma.jobOffer.findUniqueOrThrow({ where: { id: closed.id } });
    expect(reopened).toMatchObject({ status: "OPEN", closedAt: null });
  });

  it("une source en panne est consignée sans arrêter les autres ni fermer ses offres", async () => {
    await run("2026-10-07T06:00:00Z");
    const summaries = await run("2026-10-07T12:00:00Z", { failFranceTravail: true });

    const ft = summaries.find((s) => s.sourceKey === "france_travail")!;
    expect(ft.status).toBe("FAILED");
    expect(summaries.filter((s) => s.status === "SUCCESS")).toHaveLength(3);

    const logged = await prisma.sourceRun.findFirstOrThrow({
      where: { sourceKey: "france_travail" },
      orderBy: { startedAt: "desc" },
    });
    expect(logged).toMatchObject({ status: "FAILED", complete: false });
    expect(logged.error).toMatch(/HTTP 500/);
    expect(logged.error).not.toMatch(/secret/);
    expect(logged.finishedAt).not.toBeNull();
    expect(
      await prisma.jobOffer.count({ where: { source: "france_travail", status: "OPEN" } }),
    ).toBe(4);
  });

  it("une erreur levée par un connecteur n'interrompt pas les suivants", async () => {
    const broken: Connector<unknown> = {
      source: "greenhouse",
      key: "greenhouse:cassé",
      fetch: () => Promise.reject(new Error("panne simulée")),
      map: () => null,
    };
    const summaries = await runConnectors(prisma, [broken, ...connectors().slice(1)], {
      http: testHttp(fixtureFetch()),
      now: () => new Date("2026-10-07T06:00:00Z"),
      logger: silent,
    });
    expect(summaries.map((s) => s.status)).toEqual(["FAILED", "SUCCESS", "SUCCESS", "SUCCESS"]);
    expect(
      await prisma.sourceRun.count({
        where: { sourceKey: "greenhouse:cassé", error: "panne simulée" },
      }),
    ).toBe(1);
  });

  it("dédoublonne entre sources (même URL, ou entreprise + intitulé + lieu)", async () => {
    const summaries = await run("2026-10-07T06:00:00Z");
    // Vu en premier sur France Travail, puis rattaché à l'offre ATS de l'employeur.
    expect(summaries.find((s) => s.sourceKey === "france_travail")!.duplicates).toBe(0);

    const byId = (source: string, sourceId: string) =>
      prisma.jobOffer.findUniqueOrThrow({ where: { source_sourceId: { source, sourceId } } });
    const leverOffer = await byId("lever", "ebed5dab-630c-48ea-be8f-9e018797c193");
    const ashbyOffer = await byId("ashby", "8ec3768e-13cf-4e92-ba14-5d2a9484227c");
    expect((await byId("france_travail", "201TSTB")).duplicateOfId).toBe(leverOffer.id);
    expect((await byId("france_travail", "201TSTC")).duplicateOfId).toBe(ashbyOffer.id);
    expect(leverOffer.duplicateOfId).toBeNull();
    expect(ashbyOffer.duplicateOfId).toBeNull();
    expect(await prisma.jobOffer.count({ where: { duplicateOfId: null } })).toBe(10);

    // Stable au passage suivant.
    await run("2026-10-07T12:00:00Z");
    expect((await byId("france_travail", "201TSTB")).duplicateOfId).toBe(leverOffer.id);

    // L'offre canonique disparaît : son doublon redevient canonique.
    await run("2026-10-07T18:00:00Z", { drop: ["ebed5dab-630c-48ea-be8f-9e018797c193"] });
    expect((await byId("france_travail", "201TSTB")).duplicateOfId).toBeNull();
  });

  it("enregistre le salaire annoncé, null sinon, et jamais le contact recruteur", async () => {
    await run("2026-10-07T06:00:00Z");
    const dev = await prisma.jobOffer.findUniqueOrThrow({
      where: { source_sourceId: { source: "france_travail", sourceId: "201TSTA" } },
    });
    expect(Number(dev.salaryMin)).toBe(45000);
    expect(Number(dev.salaryMax)).toBe(55000);
    expect(dev).toMatchObject({
      salaryCurrency: "EUR",
      salaryPeriod: "YEAR",
      salaryVariable: "Prime, Intéressement",
    });
    expect(JSON.stringify(dev)).not.toMatch(/Claire|acme-logiciel\.example/);

    const noSalary = await prisma.jobOffer.findUniqueOrThrow({
      where: { source_sourceId: { source: "greenhouse", sourceId: "6148066004" } },
    });
    expect(noSalary).toMatchObject({
      salaryMin: null,
      salaryMax: null,
      salaryCurrency: null,
      salaryPeriod: null,
    });
  });

  it("runRadar : synchronise les entreprises configurées puis collecte toutes les sources", async () => {
    const config: RadarConfig = {
      databaseUrl: url!,
      userAgent: TEST_USER_AGENT,
      intervalHours: 6,
      runOnStart: true,
      countries: ["FR"],
      companiesFile: fileURLToPath(new URL("../fixtures/radar/companies.json", import.meta.url)),
      minIntervalMs: 1000,
      franceTravail: {
        clientId: "id",
        clientSecret: "secret",
        romeCodes: ["M1805"],
        keywords: null,
        departments: ["75"],
        maxResultsPerSearch: 150,
      },
    };
    const deps = {
      fetch: fixtureFetch(),
      sleep: noSleep,
      logger: silent,
      now: () => new Date("2026-10-07T06:00:00Z"),
    };
    const summaries = await runRadar(prisma, config, deps);
    expect(summaries.map((s) => s.sourceKey)).toEqual([
      "france_travail",
      "greenhouse:dataiku",
      "lever:qonto",
      "ashby:alan",
    ]);
    expect(summaries.every((s) => s.status === "SUCCESS")).toBe(true);
    expect(await prisma.company.count({ where: { active: true } })).toBe(3);
    const ats = await prisma.jobOffer.findFirstOrThrow({
      where: { source: "ashby" },
      include: { company: true },
    });
    expect(ats.company?.slug).toBe("alan");

    await runRadar(prisma, config, { ...deps, now: () => new Date("2026-10-07T12:00:00Z") });
    expect(await prisma.company.count()).toBe(3);
    expect(await prisma.jobOffer.count()).toBe(12);
  });
});
