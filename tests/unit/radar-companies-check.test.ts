import { describe, expect, it } from "vitest";
import {
  checkCandidate,
  checkCandidates,
  mergeAccepted,
  sameName,
  slugify,
  summarizeChecks,
  type Candidate,
} from "@/lib/radar/companies-check";
import { companyConfigSchema } from "@/lib/radar/companies";
import {
  fakeFetch,
  fixture,
  fixtureJson,
  fixtureRoutes,
  jsonResponse,
  testHttp,
} from "../helpers/radar";

const GREENHOUSE = "https://boards-api.greenhouse.io/v1/boards";

const candidate = (overrides: Partial<Candidate>): Candidate => ({
  name: "Dataiku",
  sector: "Logiciel / IA",
  ats: "greenhouse",
  boardToken: "dataiku",
  ...overrides,
});

/** Boards servis depuis les fixtures ; tout le reste répond 404. */
function boards() {
  const greenhouse = fixtureJson<{ jobs: { location: { name: string } }[] }>(
    "greenhouse-dataiku.json",
  );
  const usOnly = {
    ...greenhouse,
    jobs: greenhouse.jobs.filter((j) => j.location.name === "United States, Remote"),
  };
  return fixtureRoutes({
    [`${GREENHOUSE}/dataiku/jobs`]: () => jsonResponse(fixture("greenhouse-dataiku.json")),
    [`${GREENHOUSE}/us-only/jobs`]: () => jsonResponse(usOnly),
    [`${GREENHOUSE}/empty/jobs`]: () => jsonResponse({ jobs: [] }),
    "https://api.lever.co/v0/postings/qonto": () => jsonResponse(fixture("lever-qonto.json")),
    "https://apply.workable.com/robots.txt": () => new Response("User-agent: *\nDisallow: /v/"),
    "https://apply.workable.com/api/v1/widget/accounts/exotec": () =>
      jsonResponse(fixture("workable-exotec.json")),
    "https://api.smartrecruiters.com/robots.txt": () =>
      new Response("User-agent: LinkedInBot\nAllow: /v1/companies/\nUser-agent: *\nDisallow: /"),
  });
}

describe("vérification de la liste de référence du radar", () => {
  it("board valide : offres en France, nom confirmé par l'ATS", async () => {
    const result = await checkCandidate(testHttp(boards()), candidate({}));
    expect(result).toMatchObject({
      status: "valid",
      offers: 3,
      fr: 2,
      eu: 2,
      atsName: "Dataiku",
      identity: "confirmed",
    });
  });

  it("Lever et Workable : nom cité dans les annonces", async () => {
    const http = testHttp(boards());
    expect(
      await checkCandidate(http, candidate({ name: "Qonto", ats: "lever", boardToken: "qonto" })),
    ).toMatchObject({ status: "valid", identity: "confirmed", atsName: null });
    expect(
      await checkCandidate(
        http,
        candidate({ name: "Exotec", ats: "workable", boardToken: "exotec" }),
      ),
    ).toMatchObject({ status: "valid", identity: "confirmed" });
  });

  it("rejette jeton inconnu, board vide, offres hors UE et autre entreprise", async () => {
    const http = testHttp(boards());
    const check = (c: Partial<Candidate>) => checkCandidate(http, candidate(c));
    expect(await check({ boardToken: "inconnu" })).toMatchObject({
      status: "unknownToken",
      error: "HTTP 404",
    });
    expect(await check({ boardToken: "empty" })).toMatchObject({ status: "unknownToken" });
    expect(await check({ boardToken: "us-only" })).toMatchObject({
      status: "noEuOffers",
      offers: 1,
      eu: 0,
    });
    // Le jeton existe, mais l'ATS le rattache à une autre entreprise.
    expect(await check({ name: "Doctolib" })).toMatchObject({
      status: "nameMismatch",
      atsName: "Dataiku",
      identity: "mismatch",
    });
  });

  it("respecte robots.txt : SmartRecruiters est injoignable, sans appel à l'API", async () => {
    const fetch = boards();
    const result = await checkCandidate(
      testHttp(fetch),
      candidate({ name: "Nexity", ats: "smartrecruiters", boardToken: "Nexity" }),
    );
    expect(result.status).toBe("unreachable");
    expect(fetch.calls.map((c) => c.url)).toEqual(["https://api.smartrecruiters.com/robots.txt"]);
  });

  it("User-Agent du radar sur chaque requête", async () => {
    const fetch = fakeFetch(() => jsonResponse(fixture("greenhouse-dataiku.json")));
    await checkCandidate(testHttp(fetch), candidate({}));
    const headers = fetch.calls[0]!.init.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/^CoachCareerIA-Radar\/1\.0 \(\+/);
  });

  it("résume par ATS et ajoute les seuls candidats valides, sans doublon", async () => {
    const candidates = [
      candidate({}),
      candidate({ boardToken: "inconnu", name: "Inconnue" }),
      candidate({ name: "Qonto", ats: "lever", boardToken: "qonto" }),
      candidate({ name: "Qonto bis", ats: "lever", boardToken: "qonto" }),
    ];
    const results = await checkCandidates(testHttp(boards()), candidates, { concurrency: 2 });
    expect(results.map((r) => r.candidate.boardToken)).toEqual([
      "dataiku",
      "inconnu",
      "qonto",
      "qonto",
    ]);
    const summary = summarizeChecks(results);
    expect(summary.greenhouse).toMatchObject({ total: 2, valid: 1, unknownToken: 1 });
    expect(summary.lever).toMatchObject({ total: 2, valid: 2 });

    const existing = companyConfigSchema.parse([
      { slug: "dataiku", name: "Dataiku", ats: "greenhouse", boardToken: "dataiku" },
    ]);
    const { config, added } = mergeAccepted(existing, results);
    expect(added).toBe(1);
    expect(config.map((c) => c.slug)).toEqual(["dataiku", "qonto"]);
    expect(companyConfigSchema.safeParse(config).success).toBe(true);
  });

  it("compare les noms hors mentions juridiques", () => {
    expect(sameName("Back Market SAS", "Back Market")).toBe(true);
    expect(sameName("BackMarket", "Back Market")).toBe(true);
    expect(sameName("Mistertemp' group", "Mistertemp")).toBe(true);
    expect(sameName("Escape B.V.", "Escape")).toBe(true);
    expect(sameName("Kolsquare", "Kol")).toBe(false);
    expect(sameName("Upsun", "Platform.sh")).toBe(false);
    expect(slugify("Médecins du Monde")).toBe("medecins-du-monde");
  });
});
