import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import {
  FT_SEARCH_URL,
  FT_TOKEN_URL,
  franceTravailConnector,
} from "@/lib/radar/connectors/france-travail";
import { recruiteeConnector } from "@/lib/radar/connectors/recruitee";
import { smartRecruitersConnector } from "@/lib/radar/connectors/smartrecruiters";
import { workableConnector } from "@/lib/radar/connectors/workable";
import type { RadarConfig } from "@/lib/radar/config";
import { loadSourceHealth } from "@/lib/radar/health";
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

const SR = "https://api.smartrecruiters.com/v1/companies/Nexity/postings";

type Scenario = {
  /** Identifiants d'offres retirés des réponses (disparition). */
  drop?: string[];
  /** Hôtes dont l'API répond 500 (robots.txt reste servi). */
  down?: string[];
  /** robots.txt de SmartRecruiters tel que publié (interdit tout sauf LinkedInBot). */
  srRobotsDisallow?: boolean;
};

/** Toutes les sources servies depuis les fixtures enregistrées. */
function fixtureFetch(scenario: Scenario = {}) {
  const drop = new Set(scenario.drop ?? []);
  return async (input: string): Promise<Response> => {
    const host = new URL(input).host;
    if (input === "https://api.smartrecruiters.com/robots.txt" && scenario.srRobotsDisallow) {
      return new Response(
        "User-agent: LinkedInBot\nAllow: /v1/companies/\n\nUser-agent: *\nDisallow: /",
      );
    }
    if (input.endsWith("/robots.txt")) return new Response("User-agent: *\nDisallow: /v/");
    if (scenario.down?.includes(host)) return new Response("indisponible", { status: 500 });

    if (input.startsWith(FT_TOKEN_URL)) return jsonResponse(fixture("france-travail-token.json"));
    if (input.startsWith(FT_SEARCH_URL)) {
      const data = JSON.parse(fixture("france-travail-ats-v2.json")) as {
        resultats: { id: string }[];
      };
      const kept = data.resultats.filter((o) => !drop.has(o.id));
      return jsonResponse(
        { resultats: kept },
        { status: 206, headers: { "Content-Range": `offres 0-149/${kept.length}` } },
      );
    }
    if (input === "https://matera.recruitee.com/api/offers/") {
      const data = JSON.parse(fixture("recruitee-matera.json")) as { offers: { id: number }[] };
      return jsonResponse({ offers: data.offers.filter((o) => !drop.has(String(o.id))) });
    }
    if (input.startsWith("https://apply.workable.com/api/v1/widget/accounts/exotec")) {
      const data = JSON.parse(fixture("workable-exotec.json")) as {
        jobs: { shortcode: string }[];
      };
      return jsonResponse({ ...data, jobs: data.jobs.filter((j) => !drop.has(j.shortcode)) });
    }
    if (input.startsWith(`${SR}?`)) {
      const offset = new URL(input).searchParams.get("offset");
      const page = JSON.parse(
        fixture(`smartrecruiters-nexity-page-${offset === "0" ? 1 : 2}.json`),
      ) as { content: { id: string }[]; totalFound: number };
      return jsonResponse({ ...page, content: page.content.filter((p) => !drop.has(p.id)) });
    }
    if (input.startsWith(`${SR}/`)) {
      const details = JSON.parse(fixture("smartrecruiters-nexity-postings.json")) as Record<
        string,
        unknown
      >;
      const posting = details[input.slice(SR.length + 1)];
      return posting ? jsonResponse(posting) : new Response("not found", { status: 404 });
    }
    return new Response("not found", { status: 404 });
  };
}

const matera = company({
  slug: "matera",
  name: "Matera",
  atsType: "RECRUITEE",
  boardToken: "matera",
});
const exotec = company({
  slug: "exotec",
  name: "Exotec",
  atsType: "WORKABLE",
  boardToken: "exotec",
});
const nexity = company({
  slug: "nexity",
  name: "Nexity",
  atsType: "SMARTRECRUITERS",
  boardToken: "Nexity",
});

function connectors(srOptions: { maxPostings?: number } = {}): Connector<unknown>[] {
  return [
    franceTravailConnector(
      { clientId: "id", clientSecret: "secret" },
      { romeCodes: [], keywords: null, departments: ["75"], maxResultsPerSearch: 150 },
    ),
    recruiteeConnector(matera),
    workableConnector(exotec),
    smartRecruitersConnector(nexity, { pageSize: 3, ...srOptions }),
  ] as Connector<unknown>[];
}

describe.skipIf(!url)("Market Radar v2 (SmartRecruiters, Recruitee, Workable en base)", () => {
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

  const run = (at: string, scenario: Scenario = {}, list: Connector<unknown>[] = connectors()) =>
    runConnectors(prisma, list, {
      http: testHttp(fixtureFetch(scenario)),
      now: () => new Date(at),
      allowedCountries: ["FR"],
      logger: silent,
    });

  const offer = (source: string, sourceId: string) =>
    prisma.jobOffer.findUniqueOrThrow({ where: { source_sourceId: { source, sourceId } } });

  it("collecte les trois ATS de façon idempotente", async () => {
    const first = await run("2026-10-07T06:00:00Z");
    expect(first.map((s) => [s.sourceKey, s.status])).toEqual([
      ["france_travail", "SUCCESS"],
      ["recruitee:matera", "SUCCESS"],
      ["workable:exotec", "SUCCESS"],
      ["smartrecruiters:nexity", "SUCCESS"],
    ]);
    // Recruitee : 6 offres dont 1 à Berlin écartée ; Workable : 6 dont US et BE écartées.
    expect(first.find((s) => s.sourceKey === "recruitee:matera")).toMatchObject({
      fetched: 6,
      created: 5,
      skipped: 1,
    });
    expect(first.find((s) => s.sourceKey === "workable:exotec")).toMatchObject({
      fetched: 6,
      created: 4,
      skipped: 2,
    });
    expect(first.find((s) => s.sourceKey === "smartrecruiters:nexity")).toMatchObject({
      fetched: 5,
      created: 5,
    });
    const total = await prisma.jobOffer.count();
    expect(total).toBe(3 + 5 + 4 + 5);

    const second = await run("2026-10-07T12:00:00Z");
    expect(await prisma.jobOffer.count()).toBe(total);
    expect(second.reduce((n, s) => n + s.created + s.updated + s.closed, 0)).toBe(0);

    const manager = await offer("recruitee", "2696901");
    expect(Number(manager.salaryMin)).toBe(54000);
    expect(manager).toMatchObject({ city: "Paris", country: "FR", contractType: "CDI" });
    const nice = await offer("smartrecruiters", "744000153108379");
    expect(nice).toMatchObject({ city: "Nice", latitude: 43.7101728 });
  });

  it("ne crée aucun doublon quand l'offre est aussi sur France Travail", async () => {
    const summaries = await run("2026-10-07T06:00:00Z");
    const ft = summaries.find((s) => s.sourceKey === "france_travail")!;
    expect(ft.duplicates).toBe(0); // vue en premier, rattachée ensuite à l'ATS

    // Même entreprise + intitulé + ville (Recruitee, SmartRecruiters).
    const recruitee = await offer("recruitee", "2696901");
    expect((await offer("france_travail", "202TSTM")).duplicateOfId).toBe(recruitee.id);
    const sr = await offer("smartrecruiters", "744000153698949");
    expect((await offer("france_travail", "202TSTN")).duplicateOfId).toBe(sr.id);
    // Même URL d'origine (partenaire France Travail → annonce Workable).
    const workable = await offer("workable", "C005979099");
    expect((await offer("france_travail", "202TSTW")).duplicateOfId).toBe(workable.id);
    expect([recruitee, sr, workable].every((o) => o.duplicateOfId === null)).toBe(true);

    // Aucune offre canonique en double, et c'est stable au passage suivant.
    await run("2026-10-07T12:00:00Z");
    expect(
      await prisma.jobOffer.count({ where: { source: "france_travail", duplicateOfId: null } }),
    ).toBe(0);
    expect(await prisma.jobOffer.count({ where: { duplicateOfId: null } })).toBe(5 + 4 + 5);
  });

  it("ferme une offre disparue seulement après un passage complet", async () => {
    await run("2026-10-07T06:00:00Z");

    // Passage SmartRecruiters incomplet (plafond atteint) : rien n'est fermé.
    const partial = await run(
      "2026-10-07T09:00:00Z",
      { drop: ["744000152202129"] },
      connectors({ maxPostings: 3 }),
    );
    const srPartial = partial.find((s) => s.sourceKey === "smartrecruiters:nexity")!;
    expect(srPartial).toMatchObject({ status: "SUCCESS", complete: false, closed: 0 });
    expect((await offer("smartrecruiters", "744000152202129")).status).toBe("OPEN");

    // Passages complets : les offres retirées sont fermées.
    const full = await run("2026-10-07T12:00:00Z", {
      drop: ["744000152202129", "2696901", "C005979099"],
    });
    expect(full.find((s) => s.sourceKey === "smartrecruiters:nexity")!.closed).toBe(1);
    expect(full.find((s) => s.sourceKey === "recruitee:matera")!.closed).toBe(1);
    expect(full.find((s) => s.sourceKey === "workable:exotec")!.closed).toBe(1);
    expect(await offer("recruitee", "2696901")).toMatchObject({ status: "CLOSED" });
    // Le doublon France Travail redevient l'offre canonique.
    expect((await offer("france_travail", "202TSTM")).duplicateOfId).toBeNull();
  });

  it("une source en panne n'arrête pas les autres et ne ferme pas ses offres", async () => {
    await run("2026-10-07T06:00:00Z");
    const summaries = await run("2026-10-07T12:00:00Z", {
      down: ["apply.workable.com"],
      srRobotsDisallow: true,
      drop: ["2696901"],
    });
    expect(summaries.map((s) => [s.sourceKey, s.status])).toEqual([
      ["france_travail", "SUCCESS"],
      ["recruitee:matera", "SUCCESS"],
      ["workable:exotec", "FAILED"],
      ["smartrecruiters:nexity", "FAILED"],
    ]);
    expect(summaries[1]!.closed).toBe(1);
    expect(summaries[3]!.error).toMatch(/robots\.txt interdit/);
    expect(await prisma.jobOffer.count({ where: { source: "workable", status: "OPEN" } })).toBe(4);
    expect(
      await prisma.jobOffer.count({ where: { source: "smartrecruiters", status: "OPEN" } }),
    ).toBe(5);
  });

  it("santé des sources : dernier passage, compteurs, erreur et alerte après N échecs", async () => {
    await run("2026-10-07T06:00:00Z");
    for (const at of ["2026-10-07T12:00:00Z", "2026-10-07T18:00:00Z"]) {
      await run(at, { down: ["apply.workable.com"] });
    }
    let health = await loadSourceHealth(prisma, { threshold: 2 });
    expect(health[0]).toMatchObject({
      sourceKey: "workable:exotec",
      source: "workable",
      consecutiveFailures: 2,
      failing: true,
      lastRun: { status: "FAILED", fetchedCount: 0 },
      lastSuccessAt: new Date("2026-10-07T06:00:00Z"),
    });
    expect(health[0]!.lastError?.message).toMatch(/HTTP 500/);
    expect(health[0]!.lastError?.at).toEqual(new Date("2026-10-07T18:00:00Z"));

    const recruitee = health.find((h) => h.sourceKey === "recruitee:matera")!;
    expect(recruitee).toMatchObject({
      failing: false,
      consecutiveFailures: 0,
      lastError: null,
      lastRun: { status: "SUCCESS", fetchedCount: 6, createdCount: 0 },
    });
    // Les 3 offres France Travail, déjà rattachées aux ATS, comptent comme doublons.
    expect(health.find((h) => h.sourceKey === "france_travail")!.lastRun.duplicateCount).toBe(3);

    // Sous le seuil par défaut (3) : pas d'alerte ; un succès remet le compteur à zéro.
    expect((await loadSourceHealth(prisma)).find((h) => h.failing)).toBeUndefined();
    await run("2026-10-08T00:00:00Z");
    health = await loadSourceHealth(prisma, { threshold: 2 });
    expect(health.find((h) => h.sourceKey === "workable:exotec")).toMatchObject({
      consecutiveFailures: 0,
      failing: false,
    });
  });

  it("runRadar : nouvelle configuration d'entreprises (ATS v2, entreprise inactive)", async () => {
    const config: RadarConfig = {
      databaseUrl: url!,
      userAgent: TEST_USER_AGENT,
      intervalHours: 6,
      runOnStart: true,
      countries: ["FR"],
      companiesFile: fileURLToPath(new URL("../fixtures/radar/companies-v2.json", import.meta.url)),
      minIntervalMs: 1000,
      franceTravail: null,
    };
    const summaries = await runRadar(prisma, config, {
      fetch: fixtureFetch(),
      sleep: noSleep,
      logger: silent,
      now: () => new Date("2026-10-07T06:00:00Z"),
      geocoder: null,
    });
    expect(summaries.map((s) => [s.sourceKey, s.status])).toEqual([
      ["recruitee:matera", "SUCCESS"],
      ["workable:exotec", "SUCCESS"],
      ["smartrecruiters:nexity", "SUCCESS"],
    ]);
    expect(await prisma.company.count()).toBe(4);
    expect(await prisma.company.findUniqueOrThrow({ where: { slug: "ubisoft" } })).toMatchObject({
      atsType: "SMARTRECRUITERS",
      boardToken: "Ubisoft2",
      active: false,
    });
    const linked = await prisma.jobOffer.findFirstOrThrow({
      where: { source: "workable" },
      include: { company: true },
    });
    expect(linked.company?.slug).toBe("exotec");
  });
});
