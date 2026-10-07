import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { banProvider, banSearchUrl, parseBanResponse } from "@/lib/geo/ban";
import { distanceKm, isValidPoint, isWithinRadius } from "@/lib/geo/distance";
import {
  Geocoder,
  geoCacheKey,
  memoryGeoCache,
  NOT_FOUND_TTL_MS,
  type GeocoderOptions,
  type GeoCacheStore,
} from "@/lib/geo/geocoder";
import { geoConfig } from "@/lib/geo";
import { nominatimProvider, nominatimSearchUrl, parseNominatimResponse } from "@/lib/geo/nominatim";
import { locateOffer } from "@/lib/geo/offers";
import {
  mapFranceTravailOffer,
  type FranceTravailOffer,
} from "@/lib/radar/connectors/france-travail";
import { createLogger } from "@/lib/logger";
import { fakeFetch, fixtureJson, jsonResponse, testHttp } from "../helpers/radar";

const geoFixture = <T>(name: string): T =>
  JSON.parse(readFileSync(new URL(`../fixtures/geo/${name}`, import.meta.url), "utf8")) as T;

const PARIS = { latitude: 48.8566, longitude: 2.3522 };
const LYON = { latitude: 45.764, longitude: 4.8357 };
const MARSEILLE = { latitude: 43.2965, longitude: 5.3698 };
const VERSAILLES = { latitude: 48.8049, longitude: 2.1204 };

const BAN = "https://data.geopf.fr/geocodage/search";
const NOMINATIM = "https://nominatim.openstreetmap.org/search";

function capturingLogger() {
  const lines: string[] = [];
  return { logger: createLogger({ level: "debug", write: (_l, line) => lines.push(line) }), lines };
}

describe("distanceKm (haversine)", () => {
  it("donne les distances connues entre grandes villes", () => {
    expect(distanceKm(PARIS, LYON)).toBeCloseTo(391.5, 0);
    expect(distanceKm(PARIS, MARSEILLE)).toBeCloseTo(660.5, 0);
    expect(distanceKm(PARIS, VERSAILLES)).toBeCloseTo(17.9, 0);
  });

  it("est nulle pour un même point et symétrique", () => {
    expect(distanceKm(LYON, LYON)).toBe(0);
    expect(distanceKm(LYON, PARIS)).toBeCloseTo(distanceKm(PARIS, LYON), 9);
  });

  it("reste juste aux antipodes et de part et d'autre de l'antiméridien", () => {
    expect(
      distanceKm({ latitude: 0, longitude: 179.5 }, { latitude: 0, longitude: -179.5 }),
    ).toBeCloseTo(111.2, 0);
    expect(distanceKm({ latitude: 90, longitude: 0 }, { latitude: -90, longitude: 0 })).toBeCloseTo(
      20015.1,
      0,
    );
  });
});

describe("isWithinRadius", () => {
  const offer = { latitude: VERSAILLES.latitude, longitude: VERSAILLES.longitude };

  it("accepte une offre dans le rayon d'au moins un lieu (bord inclus)", () => {
    expect(isWithinRadius(offer, [{ ...PARIS, radiusKm: 20 }])).toBe(true);
    expect(
      isWithinRadius(offer, [
        { ...LYON, radiusKm: 50 },
        { ...PARIS, radiusKm: 20 },
      ]),
    ).toBe(true);
    const exact = distanceKm(offer, PARIS);
    expect(isWithinRadius(offer, [{ ...PARIS, radiusKm: exact }])).toBe(true);
  });

  it("refuse une offre hors rayon", () => {
    expect(isWithinRadius(offer, [{ ...PARIS, radiusKm: 10 }])).toBe(false);
    expect(isWithinRadius(offer, [{ ...LYON, radiusKm: 100 }])).toBe(false);
    expect(isWithinRadius(offer, [])).toBe(false);
  });

  it("n'invente rien : sans coordonnées, l'offre ou le lieu ne correspond pas", () => {
    expect(isWithinRadius({ latitude: null, longitude: null }, [{ ...PARIS, radiusKm: 500 }])).toBe(
      false,
    );
    expect(isWithinRadius(offer, [{ latitude: null, longitude: null, radiusKm: 500 }])).toBe(false);
    expect(
      isWithinRadius({ latitude: 0, longitude: 0 }, [
        { latitude: 0, longitude: 0.1, radiusKm: 50 },
      ]),
    ).toBe(false);
  });

  it("valide les coordonnées", () => {
    expect(isValidPoint(PARIS)).toBe(true);
    expect(isValidPoint({ latitude: 91, longitude: 0 })).toBe(false);
    expect(isValidPoint({ latitude: Number.NaN, longitude: 2 })).toBe(false);
    expect(isValidPoint(null)).toBe(false);
  });
});

describe("Base Adresse Nationale", () => {
  it("lit la commune d'une réponse BAN ([longitude, latitude])", () => {
    const result = parseBanResponse(geoFixture("ban-lyon.json"), { city: "Lyon", country: "FR" });
    expect(result).toEqual({
      latitude: 45.758,
      longitude: 4.835,
      country: "FR",
      precision: "municipality",
      provider: "ban",
    });
  });

  it("renvoie null sans résultat, et lève sur une réponse illisible", () => {
    expect(
      parseBanResponse(geoFixture("ban-empty.json"), { city: "Xyzzyville", country: "FR" }),
    ).toBeNull();
    expect(() => parseBanResponse({ oops: true }, { city: "Lyon", country: "FR" })).toThrow();
    expect(() => parseBanResponse(null, { city: "Lyon", country: "FR" })).toThrow();
  });

  it("écarte un résultat peu sûr ou d'un autre département", () => {
    const lyon = geoFixture<{ features: { properties: { score: number } }[] }>("ban-lyon.json");
    lyon.features[0]!.properties.score = 0.3;
    expect(parseBanResponse(lyon, { city: "Lyon", country: "FR" })).toBeNull();

    // Deux Saint-Denis : le code postal choisit La Réunion.
    const reunion = parseBanResponse(geoFixture("ban-saint-denis-reunion.json"), {
      city: "Saint-Denis",
      country: "FR",
      postalCode: "97400",
    });
    expect(reunion).toMatchObject({ latitude: -20.8823, longitude: 55.4481 });
  });

  it("exige le nom exact de la commune quand le pays est inconnu", () => {
    expect(
      parseBanResponse(geoFixture("ban-lyon.json"), { city: "Lyons", country: null }),
    ).toBeNull();
    expect(
      parseBanResponse(geoFixture("ban-lyon.json"), { city: "lyon", country: null }),
    ).not.toBeNull();
  });

  it("construit l'URL : communes uniquement, code commune prioritaire", () => {
    const url = new URL(
      banSearchUrl(BAN, { city: "Paris", country: "FR", cityCode: "75109", postalCode: "75009" }),
    );
    expect(url.origin + url.pathname).toBe(BAN);
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "Paris",
      type: "municipality",
      limit: "1",
      citycode: "75109",
    });
  });

  it("refait un essai sans filtre si le code commune ne donne rien", async () => {
    const fetch = fakeFetch((url) =>
      jsonResponse(
        geoFixture(new URL(url).searchParams.has("citycode") ? "ban-empty.json" : "ban-lyon.json"),
      ),
    );
    const result = await banProvider().geocode(
      { city: "Lyon", country: "FR", cityCode: "69383" },
      testHttp(fetch),
    );
    expect(result).toMatchObject({ latitude: 45.758 });
    expect(fetch.calls).toHaveLength(2);
  });
});

describe("Nominatim", () => {
  it("lit le premier lieu de niveau ville", () => {
    expect(parseNominatimResponse(geoFixture("nominatim-berlin.json"))).toEqual({
      latitude: 52.5173885,
      longitude: 13.3951309,
      country: "DE",
      precision: "municipality",
      provider: "nominatim",
    });
    expect(parseNominatimResponse([])).toBeNull();
    // Un pays entier est trop vague pour un rayon.
    expect(
      parseNominatimResponse([{ lat: "51", lon: "10", addresstype: "country", place_rank: 4 }]),
    ).toBeNull();
    expect(() => parseNominatimResponse({})).toThrow();
  });

  it("construit une recherche structurée par ville et pays", () => {
    const url = new URL(nominatimSearchUrl(NOMINATIM, { city: "Berlin", country: "DE" }));
    expect(url.searchParams.get("city")).toBe("Berlin");
    expect(url.searchParams.get("countrycodes")).toBe("de");
    expect(url.searchParams.get("format")).toBe("jsonv2");
  });

  it("plafonne le nombre de requêtes par passage", async () => {
    const fetch = fakeFetch(() => jsonResponse(geoFixture("nominatim-berlin.json")));
    const provider = nominatimProvider({ maxRequests: 1 });
    await provider.geocode({ city: "Berlin", country: "DE" }, testHttp(fetch));
    await expect(
      provider.geocode({ city: "Munich", country: "DE" }, testHttp(fetch)),
    ).rejects.toThrow(/Quota/);
    expect(fetch.calls).toHaveLength(1);
  });
});

/** Fixtures servies par fournisseur ; `fail` simule une panne. */
function geoFetch(options: { banFail?: boolean; nominatimFail?: boolean } = {}) {
  return fakeFetch((url) => {
    const u = new URL(url);
    if (url.startsWith(BAN)) {
      if (options.banFail) return new Response("panne", { status: 503 });
      return jsonResponse(
        geoFixture(u.searchParams.get("q") === "Lyon" ? "ban-lyon.json" : "ban-empty.json"),
      );
    }
    if (url.startsWith(NOMINATIM)) {
      if (options.nominatimFail) return new Response("panne", { status: 503 });
      return jsonResponse(
        u.searchParams.get("city") === "Berlin" ? geoFixture("nominatim-berlin.json") : [],
      );
    }
    return new Response("not found", { status: 404 });
  });
}

function geocoder(
  fetch: ReturnType<typeof geoFetch>,
  store: GeoCacheStore = memoryGeoCache(),
  extra: Partial<GeocoderOptions> = {},
) {
  return new Geocoder({
    http: testHttp(fetch),
    providers: [banProvider(), nominatimProvider()],
    store,
    logger: createLogger({ write: () => {} }),
    ...extra,
  });
}

describe("Geocoder", () => {
  it("géocode une ville française via la BAN puis la sert depuis le cache", async () => {
    const fetch = geoFetch();
    const store = memoryGeoCache();
    const first = await geocoder(fetch, store).geocode({ city: "Lyon", country: "FR" });
    expect(first).toMatchObject({ status: "found", result: { latitude: 45.758, provider: "ban" } });
    expect(fetch.calls).toHaveLength(1);

    // Nouvelle instance (autre passage) : le cache persistant suffit.
    const again = geocoder(fetch, store);
    const second = await again.geocode({ city: "LYON", country: "FR" });
    expect(second).toMatchObject({
      status: "found",
      result: { latitude: 45.758, provider: "cache" },
    });
    expect(fetch.calls).toHaveLength(1);
    expect(again.stats).toMatchObject({ cacheHits: 1, requests: 0, found: 1 });
  });

  it("met en cache un lieu introuvable, et le retente après expiration", async () => {
    const fetch = geoFetch();
    let now = new Date("2026-10-07T06:00:00Z");
    const store = memoryGeoCache(() => now);
    const g = geocoder(fetch, store, { now: () => now });
    expect(await g.geocode({ city: "Xyzzyville", country: "FR" })).toEqual({ status: "not_found" });
    // La BAN fait foi pour la France : Nominatim n'est pas sollicité.
    expect(fetch.calls.map((c) => new URL(c.url).host)).toEqual(["data.geopf.fr"]);

    expect(
      await geocoder(fetch, store, { now: () => now }).geocode({
        city: "Xyzzyville",
        country: "FR",
      }),
    ).toEqual({
      status: "not_found",
    });
    expect(fetch.calls).toHaveLength(1);

    now = new Date(now.getTime() + NOT_FOUND_TTL_MS + 1000);
    await geocoder(fetch, store, { now: () => now }).geocode({ city: "Xyzzyville", country: "FR" });
    expect(fetch.calls).toHaveLength(2);
  });

  it("utilise Nominatim hors de France, ou quand le pays est inconnu", async () => {
    const fetch = geoFetch();
    const g = geocoder(fetch);
    expect(await g.geocode({ city: "Berlin", country: "DE" })).toMatchObject({
      status: "found",
      result: { country: "DE", provider: "nominatim" },
    });
    expect(fetch.calls.map((c) => new URL(c.url).host)).toEqual(["nominatim.openstreetmap.org"]);

    // Saisie libre « Berlin » : la BAN ne trouve pas de commune, Nominatim oui.
    expect(await g.geocode({ city: "Berlin", country: null })).toMatchObject({ status: "found" });
    expect(fetch.calls.map((c) => new URL(c.url).host).slice(1)).toEqual([
      "data.geopf.fr",
      "nominatim.openstreetmap.org",
    ]);
  });

  it("panne : renvoie « indisponible » sans lever, sans cache, et bascule sur l'autre fournisseur", async () => {
    const store = memoryGeoCache();
    const { logger, lines } = capturingLogger();
    const down = geocoder(geoFetch({ banFail: true, nominatimFail: true }), store, { logger });
    await expect(down.geocode({ city: "Lyon", country: "FR" })).resolves.toEqual({
      status: "unavailable",
    });
    expect(store.entries.size).toBe(0);

    const banDown = geocoder(geoFetch({ banFail: true }), store);
    expect(await banDown.geocode({ city: "Berlin", country: null })).toMatchObject({
      status: "found",
      result: { provider: "nominatim" },
    });

    // Confidentialité : ni le lieu ni l'URL dans les journaux.
    expect(lines.join("\n")).not.toMatch(/Lyon/i);
    expect(lines.some((l) => l.includes("geo.provider.failed"))).toBe(true);
  });

  it("met de côté un fournisseur après plusieurs échecs (disjoncteur)", async () => {
    const fetch = geoFetch({ banFail: true, nominatimFail: true });
    const g = geocoder(fetch, memoryGeoCache(), { failureThreshold: 2 });
    for (const city of ["A", "B", "C", "D", "E"]) await g.geocode({ city, country: "FR" });
    // HttpClient : 2 tentatives par requête (1 nouvel essai) ; 2 échecs par fournisseur.
    const calls = fetch.calls.length;
    expect(g.canServe("FR")).toBe(false);
    await g.geocode({ city: "F", country: "FR" });
    expect(fetch.calls.length).toBe(calls);
    expect(g.stats.unavailable).toBe(6);
  });

  it("une base de cache en panne n'empêche pas de géocoder", async () => {
    const broken = {
      get: () => Promise.reject(new Error("db down")),
      set: () => Promise.reject(new Error("db down")),
    };
    expect(
      await geocoder(geoFetch(), broken).geocode({ city: "Lyon", country: "FR" }),
    ).toMatchObject({
      status: "found",
    });
  });

  it("normalise la clé de cache (casse, accents, espaces)", () => {
    expect(geoCacheKey({ city: "  Saint-Étienne ", country: "FR" })).toBe(
      geoCacheKey({ city: "SAINT ETIENNE", country: "FR" }),
    );
    expect(geoCacheKey({ city: "Lyon", country: null })).not.toBe(
      geoCacheKey({ city: "Lyon", country: "FR" }),
    );
  });
});

describe("géolocalisation des offres", () => {
  const now = new Date("2026-10-07T06:00:00Z");

  it("France Travail : coordonnées et code commune de l'API repris tels quels", () => {
    const page = fixtureJson<{ resultats: FranceTravailOffer[] }>("france-travail-page-1.json");
    const withCoords = mapFranceTravailOffer(page.resultats[0]!)!;
    expect(withCoords.coordinates).toEqual({ latitude: 48.877, longitude: 2.337 });
    expect(withCoords).toMatchObject({ postalCode: "75009", cityCode: "75109" });
    const without = mapFranceTravailOffer(page.resultats[1]!)!;
    expect(without.coordinates).toBeNull();
    expect(without.postalCode).toBe("75008");
  });

  it("source > géocodage ; une région seule n'est pas géocodée", async () => {
    const fetch = geoFetch();
    const g = geocoder(fetch);
    expect(await locateOffer({ city: "Lyon", country: "FR", coordinates: PARIS }, g, now)).toEqual({
      ...PARIS,
      geocodedAt: now,
    });
    expect(fetch.calls).toHaveLength(0);

    expect(await locateOffer({ city: "Lyon", country: "FR" }, g, now)).toEqual({
      latitude: 45.758,
      longitude: 4.835,
      geocodedAt: now,
    });
    expect(await locateOffer({ city: null, country: "FR" }, g, now)).toEqual({
      latitude: null,
      longitude: null,
      geocodedAt: now,
    });
  });

  it("géocodeur en panne : coordonnées nulles, à retenter (geocodedAt null)", async () => {
    const g = geocoder(geoFetch({ banFail: true, nominatimFail: true }));
    expect(await locateOffer({ city: "Lyon", country: "FR" }, g, now)).toEqual({
      latitude: null,
      longitude: null,
      geocodedAt: null,
    });
    expect(await locateOffer({ city: "Lyon", country: "FR" }, null, now)).toMatchObject({
      geocodedAt: null,
    });
  });
});

describe("configuration du géocodage", () => {
  it("se désactive sans contact pour le User-Agent", () => {
    expect(geoConfig({}).userAgent).toBeNull();
    expect(geoConfig({ RADAR_CONTACT: "https://exemple.fr/contact" }).userAgent).toBe(
      "CoachCareerIA-Geo/1.0 (+https://exemple.fr/contact)",
    );
    expect(geoConfig({ GEO_ENABLED: "false" }).enabled).toBe(false);
    expect(() => geoConfig({ GEO_BAN_URL: "pas une url" })).toThrow(/GEO_BAN_URL/);
  });
});
