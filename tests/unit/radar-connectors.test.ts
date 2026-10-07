import { describe, expect, it } from "vitest";
import { ashbyConnector, type AshbyJob } from "@/lib/radar/connectors/ashby";
import {
  FT_TOKEN_URL,
  buildSearches,
  franceTravailConnector,
  totalFromContentRange,
  type FranceTravailCriteria,
} from "@/lib/radar/connectors/france-travail";
import { greenhouseConnector } from "@/lib/radar/connectors/greenhouse";
import { leverConnector, type LeverPosting } from "@/lib/radar/connectors/lever";
import type { Connector, NormalizedOffer } from "@/lib/radar/types";
import {
  company,
  fixture,
  fixtureJson,
  fixtureRoutes,
  jsonResponse,
  testHttp,
} from "../helpers/radar";

const now = () => new Date("2026-10-07T12:00:00Z");

async function collect<Raw>(connector: Connector<Raw>, fetch: ReturnType<typeof fixtureRoutes>) {
  const result = await connector.fetch({ http: testHttp(fetch), now });
  const offers = result.items
    .map((raw) => connector.map(raw))
    .filter((o): o is NormalizedOffer => o !== null);
  return { ...result, offers };
}

describe("connecteur Greenhouse", () => {
  const dataiku = company({
    slug: "dataiku",
    name: "Dataiku",
    boardToken: "dataiku",
    sector: "Logiciel / IA",
  });
  const fetch = () =>
    fixtureRoutes({
      "https://boards-api.greenhouse.io/v1/boards/dataiku/jobs": () =>
        jsonResponse(fixture("greenhouse-dataiku.json")),
    });

  it("interroge l'API publique du board et mappe les offres", async () => {
    const f = fetch();
    const { offers, complete } = await collect(greenhouseConnector(dataiku), f);
    expect(f.calls[0]!.url).toBe(
      "https://boards-api.greenhouse.io/v1/boards/dataiku/jobs?content=true",
    );
    expect(complete).toBe(true);
    expect(offers).toHaveLength(3);

    const infra = offers.find((o) => o.sourceId === "6148066004")!;
    expect(infra).toMatchObject({
      title: "Infrastructure Engineer",
      companyName: "Dataiku",
      url: "https://job-boards.greenhouse.io/dataiku/jobs/6148066004",
      location: { city: null, country: "FR" },
      remotePolicy: "FULL_REMOTE",
      salary: null,
      sector: "Logiciel / IA",
    });
    expect(infra.publishedAt?.toISOString()).toBe("2026-08-24T09:19:58.000Z");
    // Le HTML échappé est converti en texte.
    expect(infra.description).not.toMatch(/&lt;|<p>/);
    expect(infra.description.length).toBeGreaterThan(100);

    // Multi-lieux : le lieu en France est retenu.
    expect(offers.find((o) => o.sourceId === "5420293004")!.location.country).toBe("FR");
    expect(offers.find((o) => o.sourceId === "6141886004")!.location.country).toBe("US");
  });

  it("refuse un jeton de board douteux", async () => {
    const bad = greenhouseConnector(company({ boardToken: "../admin" }));
    await expect(bad.fetch({ http: testHttp(fetch()), now })).rejects.toThrow(/invalide/);
  });

  it("signale une réponse inattendue", async () => {
    const f = fixtureRoutes({
      "https://boards-api.greenhouse.io/": () => jsonResponse({ error: "x" }),
    });
    await expect(greenhouseConnector(dataiku).fetch({ http: testHttp(f), now })).rejects.toThrow(
      /inattendue/,
    );
  });
});

describe("connecteur Lever", () => {
  const qonto = company({
    slug: "qonto",
    name: "Qonto",
    atsType: "LEVER",
    boardToken: "qonto",
    sector: "Fintech",
  });

  it("mappe les offres enregistrées", async () => {
    const f = fixtureRoutes({
      "https://api.lever.co/v0/postings/qonto": () => jsonResponse(fixture("lever-qonto.json")),
    });
    const { offers, complete } = await collect(leverConnector(qonto), f);
    expect(f.calls[0]!.url).toBe("https://api.lever.co/v0/postings/qonto?mode=json");
    expect(complete).toBe(true);
    expect(offers).toHaveLength(3);

    expect(offers.find((o) => o.title === "Analytics Engineer")).toMatchObject({
      sourceId: "ebed5dab-630c-48ea-be8f-9e018797c193",
      location: { city: "Paris", country: "FR" },
      remotePolicy: "FULL_REMOTE",
      contractType: "UNKNOWN",
      contractLabel: "Full-time",
      salary: null,
    });
    expect(offers.find((o) => o.title === "Data Engineering Intern")).toMatchObject({
      remotePolicy: "HYBRID",
      contractType: "INTERNSHIP",
    });
  });

  it("lit la fourchette de salaire structurée et l'instance EU", async () => {
    const eu = company({ atsType: "LEVER", boardToken: "exemple", atsRegion: "eu" });
    const f = fixtureRoutes({
      "https://api.eu.lever.co/v0/postings/exemple": () =>
        jsonResponse(fixture("lever-salary.json")),
    });
    const { offers } = await collect(leverConnector(eu), f);
    expect(offers[0]).toMatchObject({
      contractType: "CDI",
      remotePolicy: "HYBRID",
      location: { city: "Lyon", country: "FR" },
      salary: { min: 60000, max: 72000, currency: "EUR", period: "YEAR", raw: "60–72 k€ + BSPCE" },
    });
  });

  it("ignore une offre incomplète", () => {
    expect(leverConnector(qonto).map({ id: "x" } as LeverPosting)).toBeNull();
  });
});

describe("connecteur Ashby", () => {
  const alan = company({
    slug: "alan",
    name: "Alan",
    atsType: "ASHBY",
    boardToken: "alan",
    sector: "Assurance santé",
  });
  const routes = () =>
    fixtureRoutes({
      "https://api.ashbyhq.com/posting-api/job-board/alan": () =>
        jsonResponse(fixture("ashby-alan.json")),
    });

  it("mappe offres, rémunération et equity", async () => {
    const f = routes();
    const { offers } = await collect(ashbyConnector(alan), f);
    expect(f.calls[0]!.url).toBe(
      "https://api.ashbyhq.com/posting-api/job-board/alan?includeCompensation=true",
    );
    expect(offers).toHaveLength(3);

    expect(offers.find((o) => o.title === "IT Operations Specialist")).toMatchObject({
      location: { city: "Paris", country: "FR" },
      remotePolicy: "HYBRID",
      salary: {
        min: 46000,
        max: 53000,
        currency: "EUR",
        period: "YEAR",
        equity: "18000–27000 EUR",
      },
    });
    expect(offers.find((o) => o.title.startsWith("CTO Founder"))).toMatchObject({
      contractType: "INTERNSHIP",
      salary: null,
    });
    expect(offers.find((o) => o.title.startsWith("Founding engineer"))!.remotePolicy).toBe(
      "ONSITE",
    );
  });

  it("ignore les offres non listées", () => {
    const job = fixtureJson<{ jobs: AshbyJob[] }>("ashby-alan.json").jobs[0]!;
    expect(ashbyConnector(alan).map({ ...job, isListed: false })).toBeNull();
  });
});

describe("connecteur France Travail", () => {
  const criteria: FranceTravailCriteria = {
    romeCodes: ["M1805"],
    keywords: null,
    departments: ["75", "69", "13"],
    maxResultsPerSearch: 3150,
    pageSize: 2,
  };
  const credentials = { clientId: "id-test", clientSecret: "secret-test" };

  function routes() {
    const pages: Record<string, [string, string]> = {
      "0-1": ["france-travail-page-1.json", "offres 0-1/5"],
      "2-3": ["france-travail-page-2.json", "offres 2-3/5"],
      "4-5": ["france-travail-page-3.json", "offres 4-4/5"],
    };
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = Object.assign(
      async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        if (url === FT_TOKEN_URL) return jsonResponse(fixture("france-travail-token.json"));
        const range = new URL(url).searchParams.get("range")!;
        const page = pages[range];
        if (!page) return new Response(null, { status: 204 });
        return jsonResponse(fixture(page[0]), {
          status: 206,
          headers: { "Content-Range": page[1] },
        });
      },
      { calls },
    );
    return fetch;
  }

  it("s'authentifie (client credentials) puis pagine jusqu'au total annoncé", async () => {
    const fetch = routes();
    const connector = franceTravailConnector(credentials, criteria);
    const result = await connector.fetch({ http: testHttp(fetch), now });
    expect(result.complete).toBe(true);
    expect(result.items).toHaveLength(5);

    const token = fetch.calls[0]!;
    expect(token.url).toBe(FT_TOKEN_URL);
    expect(token.init.method).toBe("POST");
    const form = new URLSearchParams(token.init.body as string);
    expect(form.get("grant_type")).toBe("client_credentials");
    expect(form.get("scope")).toBe("api_offresdemploiv2 o2dsoffre");

    const searches = fetch.calls.slice(1);
    expect(searches.map((c) => new URL(c.url).searchParams.get("range"))).toEqual([
      "0-1",
      "2-3",
      "4-5",
    ]);
    const params = new URL(searches[0]!.url).searchParams;
    expect(params.get("codeROME")).toBe("M1805");
    expect(params.get("departement")).toBe("75,69,13");
    expect((searches[0]!.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer fixture-access-token",
    );
    // Un seul jeton pour toute la collecte.
    expect(fetch.calls.filter((c) => c.url === FT_TOKEN_URL)).toHaveLength(1);
  });

  it("marque la collecte incomplète au-delà du plafond", async () => {
    const fetch = routes();
    const connector = franceTravailConnector(credentials, { ...criteria, maxResultsPerSearch: 4 });
    const result = await connector.fetch({ http: testHttp(fetch), now });
    expect(result.complete).toBe(false);
    expect(result.items).toHaveLength(4);
  });

  it("gère une recherche sans résultat (204)", async () => {
    const fetch = Object.assign(
      async (url: string) =>
        url === FT_TOKEN_URL
          ? jsonResponse(fixture("france-travail-token.json"))
          : new Response(null, { status: 204 }),
      { calls: [] },
    );
    const result = await franceTravailConnector(credentials, criteria).fetch({
      http: testHttp(fetch),
      now,
    });
    expect(result).toEqual({ items: [], complete: true });
  });

  it("mappe le schéma normalisé et ne garde du contact que le canal de candidature", async () => {
    const connector = franceTravailConnector(credentials, criteria);
    const { items } = await connector.fetch({ http: testHttp(routes()), now });
    const offers = items.map((i) => connector.map(i)!);

    const dev = offers.find((o) => o.sourceId === "201TSTA")!;
    expect(dev).toMatchObject({
      title: "Développeur Full Stack (H/F)",
      companyName: "ACME LOGICIEL SAS",
      url: "https://candidat.francetravail.fr/offres/recherche/detail/201TSTA",
      canonicalUrl: null,
      location: { city: "Paris", region: "Île-de-France", country: "FR" },
      remotePolicy: "HYBRID",
      contractType: "CDI",
      seniority: "3 An(s)",
      sector: "Programmation informatique",
      salary: {
        min: 45000,
        max: 55000,
        currency: "EUR",
        period: "YEAR",
        variable: "Prime, Intéressement",
      },
    });
    // Courriel de candidature générique : conservé ; nom, adresse et téléphone : jamais.
    expect(dev.apply).toEqual({
      email: "recrutement@acme-logiciel.example",
      emailPersonal: false,
      url: null,
    });
    expect(JSON.stringify(dev)).not.toMatch(/Claire|Fictive|01 23 45/);

    // Phrase « Pour postuler, utiliser le lien suivant : … » : l'URL est lue, pas le téléphone.
    const apprentice = offers.find((o) => o.sourceId === "201TSTD")!;
    expect(apprentice.apply).toEqual({
      email: null,
      emailPersonal: false,
      url: "https://cabinet-fictif.example/postuler/201TSTD",
    });
    expect(JSON.stringify(apprentice)).not.toMatch(/Paul|06 11 22/);
    // Adresse citée dans le texte de l'offre (« Envoyez votre CV à … »).
    expect(offers.find((o) => o.sourceId === "201TSTC")!.apply).toMatchObject({
      email: "jobs@alan.example",
      emailPersonal: false,
    });

    expect(offers.find((o) => o.sourceId === "201TSTB")).toMatchObject({
      canonicalUrl: "https://jobs.lever.co/qonto/ebed5dab-630c-48ea-be8f-9e018797c193/apply",
      remotePolicy: "FULL_REMOTE",
      salary: { min: 45000, max: 55000, period: "YEAR" },
    });
    expect(offers.find((o) => o.sourceId === "201TSTD")).toMatchObject({
      contractType: "APPRENTICESHIP",
      remotePolicy: "ONSITE",
      seniority: "Débutant accepté",
      location: { city: "Lyon", region: "Auvergne-Rhône-Alpes" },
      salary: { min: 1200, max: 1200, period: "MONTH" },
    });
    expect(offers.find((o) => o.sourceId === "201TSTE")).toMatchObject({
      contractType: "TEMPORARY",
      companyName: null,
      salary: null,
      location: { city: "Marseille", region: "Provence-Alpes-Côte d'Azur" },
    });
  });

  it("découpe les départements par lots de 5 (limite de l'API)", () => {
    const searches = buildSearches({
      ...criteria,
      departments: ["01", "02", "03", "04", "05", "06"],
      keywords: "data",
    });
    expect(searches.map((s) => s.get("departement"))).toEqual(["01,02,03,04,05", "06"]);
    expect(searches[0]!.get("motsCles")).toBe("data");
  });

  it("lit le total de Content-Range", () => {
    expect(totalFromContentRange("offres 0-149/1234")).toBe(1234);
    expect(totalFromContentRange(null)).toBeNull();
  });
});
