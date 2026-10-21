import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { createLogger } from "@/lib/logger";
import type { RadarConfig } from "@/lib/radar/config";
import { runRadar } from "@/lib/radar/job";
import {
  STALE_PASS_MS,
  beginPass,
  interruptRunningPasses,
  loadRecentPasses,
} from "@/lib/radar/passes";
import { TEST_USER_AGENT, fakeFetch, fixture, jsonResponse, noSleep } from "../helpers/radar";

const url = process.env.TEST_DATABASE_URL;
const silent = createLogger({ write: () => {} });

const config = (): RadarConfig => ({
  databaseUrl: url!,
  userAgent: TEST_USER_AGENT,
  intervalHours: 6,
  runOnStart: true,
  countries: [],
  companiesFile: fileURLToPath(new URL("../fixtures/radar/companies.json", import.meta.url)),
  minIntervalMs: 1000,
  franceTravail: null,
});

/** Greenhouse et Lever servis depuis les fixtures ; Ashby en panne. */
function boards() {
  return fakeFetch((input) => {
    if (input.includes("greenhouse.io")) return jsonResponse(fixture("greenhouse-dataiku.json"));
    if (input.includes("lever.co")) return jsonResponse(fixture("lever-qonto.json"));
    return new Response("indisponible", { status: 500 });
  });
}

describe.skipIf(!url)("passages du radar", () => {
  let prisma: PrismaClient;

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
    await prisma?.radarPass.deleteMany({});
    await prisma?.$disconnect();
  });

  it("un seul passage à la fois ; un passage abandonné est clos comme interrompu", async () => {
    const t0 = new Date("2026-10-21T06:00:00Z");
    const first = await beginPass(prisma, t0);
    expect(first).not.toBeNull();
    // Deux démarrages simultanés pendant le premier passage : aucun n'est ouvert.
    expect(
      await Promise.all([
        beginPass(prisma, new Date(t0.getTime() + 60_000)),
        beginPass(prisma, new Date(t0.getTime() + 60_000)),
      ]),
    ).toEqual([null, null]);

    const later = await beginPass(prisma, new Date(t0.getTime() + STALE_PASS_MS + 1));
    expect(later).not.toBeNull();
    expect(await prisma.radarPass.findUniqueOrThrow({ where: { id: first!.id } })).toMatchObject({
      status: "INTERRUPTED",
    });

    // Redémarrage du worker : le passage en cours est interrompu.
    expect(await interruptRunningPasses(prisma, new Date())).toBe(1);
    expect(await prisma.radarPass.count({ where: { status: "RUNNING" } })).toBe(0);
  });

  it("enregistre la durée et les compteurs par ATS ; une source en panne n'arrête pas le passage", async () => {
    let t = new Date("2026-10-21T06:00:00Z").getTime();
    const summaries = await runRadar(prisma, config(), {
      fetch: boards(),
      sleep: noSleep,
      logger: silent,
      // Chaque lecture de l'horloge avance d'une seconde.
      now: () => new Date((t += 1000)),
      geocoder: null,
    });
    expect(summaries.map((s) => [s.sourceKey, s.status])).toEqual([
      ["greenhouse:dataiku", "SUCCESS"],
      ["lever:qonto", "SUCCESS"],
      ["ashby:alan", "FAILED"],
    ]);

    const [pass] = await loadRecentPasses(prisma);
    expect(pass).toMatchObject({ status: "FINISHED", sources: 3, failed: 1, fetched: 6 });
    expect(pass!.durationMs).toBeGreaterThan(0);
    expect(pass!.bySource).toEqual({
      greenhouse: { sources: 1, failed: 0, fetched: 3, created: 3, closed: 0 },
      lever: { sources: 1, failed: 0, fetched: 3, created: 3, closed: 0 },
      ashby: { sources: 1, failed: 1, fetched: 0, created: 0, closed: 0 },
    });
  });

  it("un passage lancé pendant un autre est écarté, sans aucune collecte", async () => {
    await beginPass(prisma, new Date());
    const fetch = boards();
    const summaries = await runRadar(prisma, config(), {
      fetch,
      sleep: noSleep,
      logger: silent,
      geocoder: null,
    });
    expect(summaries).toEqual([]);
    expect(fetch.calls).toHaveLength(0);
    expect(await prisma.sourceRun.count()).toBe(0);
  });
});
