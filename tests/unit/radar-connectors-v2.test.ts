import { describe, expect, it } from "vitest";
import { RobotsDisallowedError } from "@/lib/radar/http";
import { recruiteeConnector, type RecruiteeOffer } from "@/lib/radar/connectors/recruitee";
import {
  smartRecruitersConnector,
  type SmartRecruitersPosting,
} from "@/lib/radar/connectors/smartrecruiters";
import { workableConnector, type WorkableJob } from "@/lib/radar/connectors/workable";
import { salaryFromDescription, structuredSalary } from "@/lib/radar/salary";
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

const byId = (offers: NormalizedOffer[], id: string) => offers.find((o) => o.sourceId === id)!;

// --- SmartRecruiters ---------------------------------------------------------

const SR = "https://api.smartrecruiters.com/v1/companies/Nexity/postings";
const nexity = company({
  slug: "nexity",
  name: "Nexity",
  atsType: "SMARTRECRUITERS",
  boardToken: "Nexity",
  sector: "Immobilier",
});
const srDetails = fixtureJson<Record<string, SmartRecruitersPosting>>(
  "smartrecruiters-nexity-postings.json",
);

function srRoutes(extra: Record<string, () => Response> = {}) {
  const details = Object.fromEntries(
    Object.entries(srDetails).map(([id, posting]) => [`${SR}/${id}`, () => jsonResponse(posting)]),
  );
  return fixtureRoutes({
    [`${SR}?limit=3&offset=0`]: () => jsonResponse(fixture("smartrecruiters-nexity-page-1.json")),
    [`${SR}?limit=3&offset=3`]: () => jsonResponse(fixture("smartrecruiters-nexity-page-2.json")),
    ...details,
    ...extra,
  });
}

describe("connecteur SmartRecruiters", () => {
  it("vérifie robots.txt, pagine la liste puis lit chaque annonce", async () => {
    const f = srRoutes();
    const { offers, complete } = await collect(
      smartRecruitersConnector(nexity, { pageSize: 3 }),
      f,
    );
    const urls = f.calls.map((c) => c.url);
    expect(urls[0]).toBe("https://api.smartrecruiters.com/robots.txt");
    expect(urls.slice(1, 3)).toEqual([`${SR}?limit=3&offset=0`, `${SR}?limit=3&offset=3`]);
    // 5 offres annoncées (totalFound) : pas de 3e page, puis une requête par annonce.
    expect(urls).toHaveLength(1 + 2 + 5);
    expect(complete).toBe(true);
    expect(offers).toHaveLength(5);
  });

  it("mappe lieu, coordonnées, contrat et texte de l'annonce", async () => {
    const { offers } = await collect(smartRecruitersConnector(nexity, { pageSize: 3 }), srRoutes());
    const controller = byId(offers, "744000153698949");
    expect(controller).toMatchObject({
      title: "Contrôleur de Gestion H/F - CDI",
      url: "https://jobs.smartrecruiters.com/Nexity/744000153698949-controleur-de-gestion-h-f-cdi",
      companyName: "Nexity",
      location: { city: "La Madeleine", region: "Hauts-de-France", country: "FR" },
      postalCode: "59110",
      contractType: "CDI",
      contractLabel: "CDI",
      // « Rémunération sur 13 mois » n'est pas un montant : rien n'est déduit.
      salary: null,
      sector: "Immobilier",
      seniority: null,
    });
    expect(controller.publishedAt?.toISOString()).toBe("2026-10-06T08:51:43.139Z");
    expect(controller.description).toMatch(/Description du poste\n/);
    expect(controller.description).not.toMatch(/<p>|&#xa0;/);

    expect(byId(offers, "744000153108379").coordinates).toEqual({
      latitude: 43.7101728,
      longitude: 7.261953200000001,
    });
  });

  it("lit une rémunération annoncée dans le texte, jamais estimée", async () => {
    const { offers } = await collect(smartRecruitersConnector(nexity, { pageSize: 3 }), srRoutes());
    expect(byId(offers, "744000152202129").salary).toMatchObject({
      min: 48000,
      max: 55000,
      currency: "EUR",
      period: "YEAR",
    });
    expect(offers.filter((o) => o.salary !== null)).toHaveLength(1);
  });

  it("respecte un robots.txt qui interdit l'API, sans aucune autre requête", async () => {
    const f = srRoutes({
      "https://api.smartrecruiters.com/robots.txt": () =>
        new Response("User-agent: LinkedInBot\nAllow: /v1/companies/\nUser-agent: *\nDisallow: /", {
          status: 200,
        }),
    });
    await expect(
      smartRecruitersConnector(nexity).fetch({ http: testHttp(f), now }),
    ).rejects.toBeInstanceOf(RobotsDisallowedError);
    expect(f.calls).toHaveLength(1);
  });

  it("ignore une annonce dépubliée entre la liste et le détail (404)", async () => {
    const f = srRoutes({
      [`${SR}/744000153687839`]: () => new Response("not found", { status: 404 }),
    });
    const { offers, complete } = await collect(
      smartRecruitersConnector(nexity, { pageSize: 3 }),
      f,
    );
    expect(complete).toBe(true);
    expect(offers.map((o) => o.sourceId)).not.toContain("744000153687839");
    expect(offers).toHaveLength(4);
  });

  it("échoue (sans fermer d'offres) si un détail renvoie une erreur serveur", async () => {
    const f = srRoutes({
      [`${SR}/744000153687839`]: () => new Response("oops", { status: 400 }),
    });
    await expect(
      smartRecruitersConnector(nexity, { pageSize: 3 }).fetch({ http: testHttp(f), now }),
    ).rejects.toThrow(/HTTP 400/);
  });

  it("marque la collecte incomplète au-delà du plafond", async () => {
    const { complete, offers } = await collect(
      smartRecruitersConnector(nexity, { pageSize: 3, maxPostings: 3 }),
      srRoutes(),
    );
    expect(complete).toBe(false);
    expect(offers).toHaveLength(3);
  });

  it("tolère les champs manquants et écarte les offres inexploitables", () => {
    const connector = smartRecruitersConnector(nexity);
    expect(connector.map({ id: "1" })).toBeNull();
    expect(connector.map({ id: "1", name: "Juriste", active: false })).toBeNull();
    expect(connector.map({ id: "1", name: "Juriste", visibility: "INTERNAL" })).toBeNull();
    expect(connector.map({ id: "1", name: "Juriste" })).toMatchObject({
      url: "https://jobs.smartrecruiters.com/Nexity/1",
      description: "",
      location: { city: null, region: null, country: null },
      coordinates: null,
      remotePolicy: "UNKNOWN",
      contractType: "UNKNOWN",
      salary: null,
      publishedAt: null,
    });
    expect(
      connector.map({
        id: "2",
        name: "Stagiaire juridique",
        location: { remote: true },
        typeOfEmployment: { id: "intern", label: "Internship" },
      }),
    ).toMatchObject({ remotePolicy: "FULL_REMOTE", contractType: "INTERNSHIP" });
  });

  it("signale une réponse inattendue", async () => {
    const f = fixtureRoutes({ [SR]: () => jsonResponse({ message: "x" }) });
    await expect(
      smartRecruitersConnector(nexity).fetch({ http: testHttp(f), now }),
    ).rejects.toThrow(/inattendue/);
  });
});

// --- Recruitee ---------------------------------------------------------------

const matera = company({
  slug: "matera",
  name: "Matera",
  atsType: "RECRUITEE",
  boardToken: "matera",
  sector: "Immobilier / proptech",
});

describe("connecteur Recruitee", () => {
  const routes = () =>
    fixtureRoutes({
      "https://matera.recruitee.com/api/offers/": () =>
        jsonResponse(fixture("recruitee-matera.json")),
    });

  it("vérifie robots.txt puis lit toutes les offres du site carrière", async () => {
    const f = routes();
    const { offers, complete } = await collect(recruiteeConnector(matera), f);
    expect(f.calls.map((c) => c.url)).toEqual([
      "https://matera.recruitee.com/robots.txt",
      "https://matera.recruitee.com/api/offers/",
    ]);
    expect(complete).toBe(true);
    expect(offers).toHaveLength(6);
  });

  it("mappe salaire structuré, télétravail, contrat et lieu", async () => {
    const { offers } = await collect(recruiteeConnector(matera), routes());
    const manager = byId(offers, "2696901");
    expect(manager).toMatchObject({
      title: "CDI - Gestionnaire de Copropriétés (IDF)",
      url: "https://matera.recruitee.com/o/cdi-gestionnaire-de-coproprietes-idf",
      location: { city: "Paris", region: "Île-de-France", country: "FR" },
      postalCode: "75010",
      remotePolicy: "HYBRID",
      contractType: "CDI",
      contractLabel: "fulltime_permanent",
      salary: { min: 54000, max: 59000, currency: "EUR", period: "YEAR" },
    });
    expect(manager.description).toMatch(/Gestionnaire de Copr/);
    expect(manager.publishedAt?.toISOString()).toBe("2026-09-24T15:09:18.000Z");

    // Code « contract » ambigu : l'intitulé (« CDI ») fait foi.
    expect(offers.find((o) => o.title === "Staff Security Engineer (CDI)")).toMatchObject({
      contractType: "CDI",
      salary: { min: 88000, max: 100000 },
    });
    expect(offers.find((o) => o.title === "Agent.e de visite")).toMatchObject({
      remotePolicy: "FULL_REMOTE",
      contractType: "FREELANCE",
      salary: null,
    });
    expect(offers.find((o) => o.title.startsWith("Alternance"))).toMatchObject({
      contractType: "APPRENTICESHIP",
      salary: null,
    });
  });

  it("ne corrige ni ne complète une rémunération douteuse ou sans période", async () => {
    const { offers } = await collect(recruiteeConnector(matera), routes());
    // Saisie « 40.00 – 45000 » : bornes incohérentes, seul le texte brut est gardé.
    expect(offers.find((o) => o.title.startsWith("Customer Care"))).toMatchObject({
      location: { city: "Berlin", country: "DE" },
      salary: { min: null, max: null, currency: null, period: null, raw: "40–45000 EUR / year" },
    });
    // Stage sans période : montants gardés, période inconnue.
    expect(offers.find((o) => o.title.startsWith("Stage"))).toMatchObject({
      contractType: "INTERNSHIP",
      salary: { min: 1000, max: 1200, currency: "EUR", period: null },
    });
  });

  it("écarte les offres non publiées ou incomplètes", () => {
    const connector = recruiteeConnector(matera);
    const base: RecruiteeOffer = {
      id: 1,
      title: "Juriste",
      careers_url: "https://matera.recruitee.com/o/juriste",
    };
    expect(connector.map({ ...base, status: "draft" })).toBeNull();
    expect(connector.map({ ...base, title: " " })).toBeNull();
    expect(connector.map(base)).toMatchObject({
      location: { city: null, country: null },
      remotePolicy: "UNKNOWN",
      contractType: "UNKNOWN",
      salary: null,
    });
  });

  it("préfère un lieu en France parmi plusieurs", () => {
    const offer = recruiteeConnector(matera).map({
      id: 2,
      title: "Account Manager",
      careers_url: "https://matera.recruitee.com/o/am",
      city: "Berlin",
      country_code: "DE",
      locations: [
        { city: "Berlin", country_code: "DE" },
        { city: "Lyon", state: "Auvergne-Rhône-Alpes", country_code: "FR", postal_code: "69002" },
      ],
    });
    expect(offer).toMatchObject({ location: { city: "Lyon", country: "FR" }, postalCode: "69002" });
  });

  it("refuse un sous-domaine douteux", async () => {
    await expect(async () =>
      recruiteeConnector(company({ boardToken: "evil.com/x" })).fetch({
        http: testHttp(routes()),
        now,
      }),
    ).rejects.toThrow(/invalide/);
  });
});

// --- Workable ----------------------------------------------------------------

const exotec = company({
  slug: "exotec",
  name: "Exotec",
  atsType: "WORKABLE",
  boardToken: "exotec",
  sector: "Robotique / logistique",
});
const WK = "https://apply.workable.com/api/v1/widget/accounts/exotec";

describe("connecteur Workable", () => {
  const routes = () => fixtureRoutes({ [WK]: () => jsonResponse(fixture("workable-exotec.json")) });

  it("vérifie robots.txt puis lit le widget avec le texte des annonces", async () => {
    const f = routes();
    const { offers, complete } = await collect(workableConnector(exotec), f);
    expect(f.calls.map((c) => c.url)).toEqual([
      "https://apply.workable.com/robots.txt",
      `${WK}?details=true`,
    ]);
    expect(complete).toBe(true);
    expect(offers).toHaveLength(6);
  });

  it("mappe le schéma normalisé", async () => {
    const { offers } = await collect(workableConnector(exotec), routes());
    const buyer = byId(offers, "C005979099");
    expect(buyer).toMatchObject({
      title: "Acheteur IT senior (achats indirects)",
      url: "https://apply.workable.com/j/C005979099",
      companyName: "Exotec",
      location: { city: "Lille", region: "Hauts-de-France", country: "FR" },
      contractType: "UNKNOWN",
      contractLabel: "Full-time",
      salary: null,
      seniority: "Mid-Senior level",
    });
    expect(buyer.publishedAt?.toISOString()).toBe("2026-09-18T00:00:00.000Z");
    expect(buyer.description).toMatch(/Exotec/);
    expect(buyer.description).not.toMatch(/<p>|&nbsp;/);

    expect(byId(offers, "AAA9733BFC").contractType).toBe("CDD");
    expect(byId(offers, "20C3B81207")).toMatchObject({
      remotePolicy: "FULL_REMOTE",
      location: { country: "BE" },
    });
  });

  it("lit un salaire explicite du texte et rien d'autre", async () => {
    const { offers } = await collect(workableConnector(exotec), routes());
    expect(byId(offers, "C58975B7C5")).toMatchObject({
      location: { country: "US" },
      salary: { min: 19, max: 22, currency: "USD", period: "HOUR" },
    });
    // « Salaire annuel brut compétitif » : aucun montant, donc aucun salaire.
    expect(byId(offers, "28831EEBE1").salary).toBeNull();
  });

  it("préfère un lieu visible en France et tolère les champs manquants", () => {
    const connector = workableConnector(exotec);
    const job: WorkableJob = {
      shortcode: "X1",
      title: "Technicien",
      url: "https://apply.workable.com/j/X1",
      locations: [
        { country: "France", countryCode: "FR", city: "Paris", hidden: true },
        { country: "Germany", countryCode: "DE", city: "Berlin" },
        { country: "France", countryCode: "FR", city: "Croix", region: "Hauts-de-France" },
      ],
    };
    expect(connector.map(job)).toMatchObject({
      location: { city: "Croix", country: "FR" },
      description: "",
      salary: null,
      publishedAt: null,
    });
    expect(connector.map({ shortcode: "X2", title: "Sans lien" })).toBeNull();
    expect(
      connector.map({
        shortcode: "X3",
        title: "Stage",
        shortlink: "https://apply.workable.com/j/X3",
      }),
    ).toMatchObject({ url: "https://apply.workable.com/j/X3", contractType: "INTERNSHIP" });
    expect(
      connector.map({
        shortcode: "X4",
        title: "Coordinateur logistique",
        url: "https://apply.workable.com/j/X4",
        employment_type: "Temporary",
      }),
    ).toMatchObject({ contractType: "CDD", contractLabel: "Temporary" });
  });

  it("signale une réponse inattendue", async () => {
    const f = fixtureRoutes({ [WK]: () => jsonResponse({ name: "Exotec" }) });
    await expect(workableConnector(exotec).fetch({ http: testHttp(f), now })).rejects.toThrow(
      /inattendue/,
    );
  });
});

// --- Rémunération ------------------------------------------------------------

describe("rémunérations des nouveaux ATS", () => {
  it("structuredSalary lit les chaînes numériques et refuse les bornes incohérentes", () => {
    expect(
      structuredSalary({ min: "54000", max: "59000", currency: "eur", period: "year" }),
    ).toEqual({
      min: 54000,
      max: 59000,
      currency: "EUR",
      period: "YEAR",
      variable: null,
      equity: null,
      raw: "54000–59000 EUR / year",
    });
    expect(structuredSalary({ min: null, max: null, currency: "EUR", period: "month" })).toBeNull();
    expect(
      structuredSalary({ min: "60000", max: "50000", currency: "EUR", period: "year" }),
    ).toMatchObject({ min: null, max: null, raw: "60000–50000 EUR / year" });
    expect(
      structuredSalary({ min: "2000", max: null, currency: "EUR", period: "month" }),
    ).toMatchObject({ min: 2000, max: null, period: "MONTH" });
  });

  it("salaryFromDescription ne lit que les lignes qui parlent de rémunération", () => {
    expect(
      salaryFromDescription(
        "Chiffre d'affaires de 40 M€ en 2025.\nSalaire : 45-55 k€ selon profil",
      ),
    ).toMatchObject({ min: 45000, max: 55000, currency: "EUR", period: "YEAR" });
    expect(salaryFromDescription("Chiffre d'affaires de 40 M€, 300 salariés.")).toBeNull();
    expect(salaryFromDescription("Rémunération attractive + tickets restaurant")).toBeNull();
    expect(salaryFromDescription(null)).toBeNull();
  });
});
