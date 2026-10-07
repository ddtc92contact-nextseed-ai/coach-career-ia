import type { HttpClient } from "@/lib/radar/http";

/** Lieu à géocoder : une ville, avec ce que la source sait de plus. */
export type GeoQuery = {
  city: string;
  /** ISO 3166-1 alpha-2 ; `null` = inconnu (saisie libre du candidat). */
  country: string | null;
  postalCode?: string | null;
  /** Code commune INSEE (France), le plus fiable quand la source le donne. */
  cityCode?: string | null;
};

export type GeoPrecision = "address" | "street" | "locality" | "municipality" | "region";

export type GeoResult = {
  latitude: number;
  longitude: number;
  country: string | null;
  precision: GeoPrecision;
  /** Fournisseur qui a répondu (`ban`, `nominatim`) ou `cache`. */
  provider: string;
};

/**
 * Fournisseur de géocodage. `geocode` renvoie `null` si le lieu est
 * introuvable et LÈVE en cas de panne (réseau, 5xx, réponse illisible) : le
 * géocodeur distingue ainsi « introuvable » (mis en cache) de « indisponible »
 * (réessayé plus tard).
 */
export interface GeocodingProvider {
  name: string;
  /** Peut-il traiter ce pays ? `null` = pays inconnu. */
  supports(country: string | null): boolean;
  /** Réponse faisant foi pour ce pays : un « introuvable » n'est pas retenté ailleurs. */
  authoritativeFor(country: string | null): boolean;
  geocode(query: GeoQuery, http: HttpClient): Promise<GeoResult | null>;
}

export type GeocodeOutcome =
  | { status: "found"; result: GeoResult }
  | { status: "not_found" }
  /** Aucun fournisseur n'a pu répondre : ne rien conclure, réessayer plus tard. */
  | { status: "unavailable" };
