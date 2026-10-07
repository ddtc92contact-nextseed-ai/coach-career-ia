import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { banProvider } from "@/lib/geo/ban";
import { Geocoder, prismaGeoCache } from "@/lib/geo/geocoder";
import { nominatimProvider } from "@/lib/geo/nominatim";
import { backfillOfferCoordinates } from "@/lib/geo/offers";
import { createLogger } from "@/lib/logger";
import {
  FT_SEARCH_URL,
  FT_TOKEN_URL,
  franceTravailConnector,
} from "@/lib/radar/connectors/france-travail";
import { greenhouseConnector } from "@/lib/radar/connectors/greenhouse";
import { leverConnector } from "@/lib/radar/connectors/lever";
import { runConnectors } from "@/lib/radar/pipeline";
import type { Connector } from "@/lib/radar/types";
import { company, fakeFetch, fixture, jsonResponse, testHttp } from "../helpers/radar";

const url = process.env.TEST_DATABASE_URL;
const silent = createLogger({ write: () => {} });
const geoFixture = (name: string) =>
  readFileSync(new URL(`../fixtures/geo/${name}`, import.meta.url), "utf8");

/** Sources du radar servies depuis les fixtures (France Travail + Lever + Greenhouse). */
function radarFetch() {
  return fakeFetch((input) => {
    if (input.startsWith(FT_TOKEN_URL)) return jsonResponse(fixture("france-travail-token.json"));
    if (input.startsWith(FT_SEARCH_URL)) {
      const offers = ["france-travail-page-1.json", "france-travail-page-2.json"].flatMap(
        (f) => (JSON.parse(fixture(f)) as { resultats: unknown[] }).resultats,
      );
      return jsonResponse(
        { resultats: offers },
        { status: 206, headers: { "Content-Range": `offres 0-149/${offers.length}` } },
      );
    }
    if (input.includes("greenhouse.io")) return jsonResponse(fixture("greenhouse-dataiku.json"));
    if (input.includes("lever.co")) return jsonResponse(fixture("lever-qonto.json"));
    return new Response("not found", { status: 404 });
  });
}

/** BAN simulée : Paris et Lyon connus ; `down` simule une panne. */
function banFetch(state: { down: boolean }) {
  return fakeFetch((input) => {
    if (state.down) return new Response("indisponible", { status: 503 });
    const q = new URL(input).searchParams.get("q");
    if (q === "Paris") return jsonResponse(geoFixture("ban-paris.json"));
    if (q === "Lyon") return jsonResponse(geoFixture("ban-lyon.json"));
    return jsonResponse(geoFixture("ban-empty.json"));
  });
}

function connectors(): Connector<unknown>[] {
  return [
    franceTravailConnector(
      { clientId: "id", clientSecret: "secret" },
      { romeCodes: [], keywords: null, departments: ["75"], maxResultsPerSearch: 150 },
    ),
    greenhouseConnector(company({ slug: "dataiku", name: "Dataiku", boardToken: "dataiku" })),
    leverConnector(
      company({ slug: "qonto", name: "Qonto", atsType: "LEVER", boardToken: "qonto" }),
    ),
  ] as Connector<unknown>[];
}

describe.skipIf(!url)("Market Radar : géocodage des offres (en base)", () => {
  let prisma: PrismaClient;
  const ban = { down: false };
  let geoCalls: ReturnType<typeof banFetch>;

  const geocoder = () =>
    new Geocoder({
      http: testHttp(geoCalls),
      // Nominatim désactivé de fait : toutes les offres des fixtures sont en France.
      providers: [banProvider(), nominatimProvider({ maxRequests: 0 })],
      store: prismaGeoCache(prisma),
      logger: silent,
    });

  const run = (at: string, g: Geocoder | null) =>
    runConnectors(prisma, connectors(), {
      http: testHttp(radarFetch()),
      now: () => new Date(at),
      allowedCountries: ["FR"],
      logger: silent,
      geocoder: g,
    });

  const offer = (source: string, sourceId: string) =>
    prisma.jobOffer.findUniqueOrThrow({ where: { source_sourceId: { source, sourceId } } });

  beforeAll(() => {
    prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url! }) });
  });

  beforeEach(async () => {
    await prisma.jobOffer.deleteMany({});
    await prisma.sourceRun.deleteMany({});
    await prisma.company.deleteMany({});
    await prisma.geoCache.deleteMany({});
    ban.down = false;
    geoCalls = banFetch(ban);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("géocode les nouvelles offres, reprend les coordonnées France Travail, met en cache", async () => {
    const summaries = await run("2026-10-07T06:00:00Z", geocoder());
    expect(summaries.every((s) => s.status === "SUCCESS")).toBe(true);

    // Coordonnées fournies par l'API : aucun géocodage.
    expect(await offer("france_travail", "201TSTA")).toMatchObject({
      latitude: 48.877,
      longitude: 2.337,
    });
    expect(await offer("france_travail", "201TSTD")).toMatchObject({
      latitude: 45.758,
      longitude: 4.835,
    });
    const lever = await prisma.jobOffer.findMany({ where: { source: "lever" } });
    expect(lever.every((o) => o.latitude === 48.859 && o.geocodedAt !== null)).toBe(true);
    // « France, Remote » : pas de ville, rien à géocoder (et pas de centroïde inventé).
    const remote = await prisma.jobOffer.findMany({ where: { source: "greenhouse" } });
    expect(remote.every((o) => o.latitude === null && o.geocodedAt !== null)).toBe(true);

    // Lever : 3 offres à Paris → une seule requête (puis cache mémoire).
    const leverQueries = geoCalls.calls.filter((c) => !new URL(c.url).searchParams.has("postcode"));
    expect(leverQueries).toHaveLength(1);
    expect(await prisma.geoCache.count({ where: { found: true } })).toBeGreaterThan(0);

    // Passage suivant, nouveau géocodeur : rien n'est regéocodé.
    const before = geoCalls.calls.length;
    const second = await run("2026-10-07T12:00:00Z", geocoder());
    expect(second.reduce((n, s) => n + s.updated + s.created, 0)).toBe(0);
    expect(geoCalls.calls.length).toBe(before);
  });

  it("géocodeur en panne : le passage réussit, puis le rattrapage complète les coordonnées", async () => {
    ban.down = true;
    const summaries = await run("2026-10-07T06:00:00Z", geocoder());
    expect(summaries.every((s) => s.status === "SUCCESS")).toBe(true);
    expect(await prisma.jobOffer.count()).toBe(9);
    expect(await offer("france_travail", "201TSTA")).toMatchObject({ latitude: 48.877 });
    const pending = await prisma.jobOffer.count({ where: { geocodedAt: null } });
    expect(pending).toBe(6); // 3 France Travail sans coordonnées + 3 Lever.
    expect(await prisma.geoCache.count()).toBe(0);

    ban.down = false;
    const summary = await backfillOfferCoordinates(prisma, geocoder(), { logger: silent });
    expect(summary).toMatchObject({ scanned: 6, located: 6, pending: 0 });
    expect(await prisma.jobOffer.count({ where: { geocodedAt: null } })).toBe(0);

    // Idempotent : plus rien à rattraper.
    expect(await backfillOfferCoordinates(prisma, geocoder(), { logger: silent })).toMatchObject({
      scanned: 0,
    });
  });

  it("sans géocodeur, les offres déjà en base sont rattrapées au passage suivant", async () => {
    await run("2026-10-07T06:00:00Z", null);
    expect(await prisma.jobOffer.count({ where: { geocodedAt: null } })).toBe(6);
    const summaries = await run("2026-10-07T12:00:00Z", geocoder());
    expect(summaries.reduce((n, s) => n + s.unchanged, 0)).toBe(9);
    expect(await prisma.jobOffer.count({ where: { geocodedAt: null } })).toBe(0);
    expect((await offer("lever", "ebed5dab-630c-48ea-be8f-9e018797c193")).latitude).toBe(48.859);
  });
});
