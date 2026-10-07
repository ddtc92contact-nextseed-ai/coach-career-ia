import { isValidPoint } from "./distance";
import type { GeocodingProvider, GeoPrecision, GeoQuery, GeoResult } from "./types";

/**
 * Nominatim (OpenStreetMap), repli pour les villes hors de France.
 * Politique d'usage respectée (https://operations.osmfoundation.org/policies/nominatim/) :
 * - 1 requête par seconde au plus (intervalle de 1,1 s imposé par le client HTTP) ;
 * - User-Agent identifiant l'application et son contact ;
 * - résultats mis en cache (table `geo_cache`) : une ville n'est demandée qu'une fois ;
 * - volume plafonné par passage (`maxRequests`) : pas de géocodage en masse ;
 * - attribution « © les contributeurs d'OpenStreetMap » (README).
 * `GEO_NOMINATIM_URL` permet de pointer vers une instance auto-hébergée.
 */
export const NOMINATIM_DEFAULT_URL = "https://nominatim.openstreetmap.org/search";
export const NOMINATIM_MIN_INTERVAL_MS = 1100;

export type NominatimPlace = {
  lat?: string;
  lon?: string;
  category?: string;
  type?: string;
  addresstype?: string;
  place_rank?: number;
  address?: { country_code?: string };
};

const MUNICIPALITY = new Set([
  "city",
  "town",
  "village",
  "municipality",
  "hamlet",
  "suburb",
  "borough",
  "city_district",
  "quarter",
  "neighbourhood",
]);

export class NominatimBudgetExceeded extends Error {
  constructor() {
    super("Quota de requêtes Nominatim atteint pour ce passage");
    this.name = "NominatimBudgetExceeded";
  }
}

export function nominatimSearchUrl(baseUrl: string, query: GeoQuery): string {
  const params = new URLSearchParams({
    city: query.city,
    format: "jsonv2",
    limit: "1",
    addressdetails: "1",
    "accept-language": "fr",
  });
  if (query.country) params.set("countrycodes", query.country.toLowerCase());
  if (query.postalCode) params.set("postalcode", query.postalCode);
  return `${baseUrl}?${params.toString()}`;
}

/** Lit le premier lieu de niveau ville ou plus fin. Lève si la réponse est illisible. */
export function parseNominatimResponse(data: unknown): GeoResult | null {
  if (!Array.isArray(data)) throw new Error("Réponse Nominatim illisible");
  for (const place of data as NominatimPlace[]) {
    const point = { latitude: Number(place.lat), longitude: Number(place.lon) };
    if (!isValidPoint(point)) continue;
    const kind = place.addresstype ?? place.type ?? "";
    let precision: GeoPrecision;
    if (MUNICIPALITY.has(kind)) precision = "municipality";
    else if ((place.place_rank ?? 0) >= 26) precision = "street";
    else if ((place.place_rank ?? 0) >= 12) precision = "region";
    else continue; // Pays, continent : trop vague pour un rayon en km.
    return {
      ...point,
      country: place.address?.country_code?.toUpperCase() ?? null,
      precision,
      provider: "nominatim",
    };
  }
  return null;
}

export function nominatimProvider(
  options: { baseUrl?: string; maxRequests?: number } = {},
): GeocodingProvider {
  const baseUrl = options.baseUrl ?? NOMINATIM_DEFAULT_URL;
  const maxRequests = options.maxRequests ?? 200;
  let used = 0;
  return {
    name: "nominatim",
    supports: () => true,
    authoritativeFor: (country) => country !== null,
    async geocode(query, http) {
      if (used >= maxRequests) throw new NominatimBudgetExceeded();
      used++;
      const { data } = await http.getJson<NominatimPlace[]>(nominatimSearchUrl(baseUrl, query));
      return parseNominatimResponse(data);
    },
  };
}
