import { foldText } from "@/lib/radar/text";
import { isValidPoint } from "./distance";
import type { GeocodingProvider, GeoPrecision, GeoQuery, GeoResult } from "./types";

/**
 * Base Adresse Nationale : géocodeur officiel français, gratuit et sans clé.
 * Depuis 2025 il est servi par la Géoplateforme de l'IGN (l'ancienne adresse
 * `api-adresse.data.gouv.fr` redirige vers celle-ci et est décommissionnée) :
 * https://geoservices.ign.fr/documentation/services/services-geoplateforme/geocodage
 * Limite documentée : 50 requêtes/s par IP ; on reste très en dessous.
 */
export const BAN_DEFAULT_URL = "https://data.geopf.fr/geocodage/search";

/** France métropolitaine et outre-mer couverts par la BAN. */
const BAN_COUNTRIES = new Set(["FR", "GP", "MQ", "GF", "RE", "YT", "PM", "BL", "MF"]);

/** Score minimal d'un résultat : plus exigeant quand le pays est inconnu. */
const MIN_SCORE_KNOWN_COUNTRY = 0.5;
const MIN_SCORE_UNKNOWN_COUNTRY = 0.7;

export type BanFeature = {
  geometry?: { type?: string; coordinates?: unknown };
  properties?: {
    label?: string;
    score?: number;
    type?: string;
    citycode?: string;
    postcode?: string;
    city?: string;
    name?: string;
  };
};

export type BanResponse = { type?: string; features?: BanFeature[] };

const PRECISIONS: Record<string, GeoPrecision> = {
  housenumber: "address",
  street: "street",
  locality: "locality",
  municipality: "municipality",
};

export function banSearchUrl(baseUrl: string, query: GeoQuery, withFilters = true): string {
  const params = new URLSearchParams({ q: query.city, type: "municipality", limit: "1" });
  if (withFilters && query.cityCode) params.set("citycode", query.cityCode);
  else if (withFilters && query.postalCode) params.set("postcode", query.postalCode);
  return `${baseUrl}?${params.toString()}`;
}

/** Département d'un code postal ou INSEE (« 69003 » → « 69 », « 97411 » → « 974 »). */
function department(code: string | null | undefined): string | null {
  if (!code || code.length < 2) return null;
  return code.startsWith("97") ? code.slice(0, 3) : code.slice(0, 2);
}

/**
 * Lit la meilleure commune d'une réponse BAN (GeoJSON). `null` si la réponse
 * ne contient aucun résultat assez sûr. Lève si la réponse est illisible.
 */
export function parseBanResponse(data: unknown, query: GeoQuery): GeoResult | null {
  if (!data || typeof data !== "object" || !Array.isArray((data as BanResponse).features)) {
    throw new Error("Réponse BAN illisible");
  }
  const minScore = query.country ? MIN_SCORE_KNOWN_COUNTRY : MIN_SCORE_UNKNOWN_COUNTRY;
  const expectedDept = department(query.cityCode ?? query.postalCode);
  for (const feature of (data as BanResponse).features!) {
    const props = feature.properties ?? {};
    const coords = feature.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    // GeoJSON : [longitude, latitude].
    const point = { latitude: Number(coords[1]), longitude: Number(coords[0]) };
    if (!isValidPoint(point)) continue;
    if (typeof props.score === "number" && props.score < minScore) continue;
    const foundDept = department(props.citycode ?? props.postcode);
    if (expectedDept && foundDept && expectedDept !== foundDept) continue;
    // Sans pays connu, la commune doit vraiment porter ce nom (« Berlin » ≠ « Rue de Berlin »).
    if (!query.country && props.city && foldText(props.city) !== foldText(query.city)) continue;
    return {
      ...point,
      country: "FR",
      precision: PRECISIONS[props.type ?? ""] ?? "municipality",
      provider: "ban",
    };
  }
  return null;
}

export function banProvider(options: { baseUrl?: string } = {}): GeocodingProvider {
  const baseUrl = options.baseUrl ?? BAN_DEFAULT_URL;
  return {
    name: "ban",
    supports: (country) => country === null || BAN_COUNTRIES.has(country),
    authoritativeFor: (country) => country !== null && BAN_COUNTRIES.has(country),
    async geocode(query, http) {
      const { data } = await http.getJson<BanResponse>(banSearchUrl(baseUrl, query));
      const result = parseBanResponse(data, query);
      if (result || !(query.cityCode || query.postalCode)) return result;
      // Le filtre code commune / postal peut être trop strict (arrondissements,
      // communes nouvelles) : nouvel essai par le nom, département vérifié.
      const retry = await http.getJson<BanResponse>(banSearchUrl(baseUrl, query, false));
      return parseBanResponse(retry.data, query);
    },
  };
}
