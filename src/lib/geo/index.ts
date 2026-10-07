import { z } from "zod";
import type { PrismaClient } from "@/generated/prisma/client";
import type { Logger } from "@/lib/logger";
import { HttpClient, type FetchLike } from "@/lib/radar/http";
import { BAN_DEFAULT_URL, banProvider } from "./ban";
import { Geocoder, prismaGeoCache, type GeoCacheStore } from "./geocoder";
import { NOMINATIM_DEFAULT_URL, NOMINATIM_MIN_INTERVAL_MS, nominatimProvider } from "./nominatim";
import type { GeocodingProvider } from "./types";

export { distanceKm, isValidPoint, isWithinRadius } from "./distance";
export type { GeoPoint, MaybeGeoPoint, RadiusLocation } from "./distance";
export { Geocoder, geoCacheKey, memoryGeoCache, prismaGeoCache } from "./geocoder";
export type { GeocodeOutcome, GeoQuery, GeoResult, GeocodingProvider } from "./types";

/**
 * Configuration du géocodage, lue depuis l'environnement (aucune clé requise :
 * BAN et Nominatim sont publics). Partagée par le worker et l'application.
 */
const geoEnvSchema = z.object({
  GEO_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  GEO_BAN_URL: z.url().default(BAN_DEFAULT_URL),
  GEO_NOMINATIM_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  GEO_NOMINATIM_URL: z.url().default(NOMINATIM_DEFAULT_URL),
  GEO_NOMINATIM_MAX_PER_RUN: z.coerce.number().int().min(0).max(5000).default(200),
  GEO_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(5000),
  RADAR_CONTACT: z.string().trim().optional(),
  AUTH_URL: z.string().trim().optional(),
});

export type GeoConfig = {
  enabled: boolean;
  /** `null` sans contact configuré : le géocodage est alors désactivé. */
  userAgent: string | null;
  banUrl: string;
  nominatimEnabled: boolean;
  nominatimUrl: string;
  nominatimMaxRequests: number;
  timeoutMs: number;
};

export const GEO_PRODUCT = "CoachCareerIA-Geo/1.0";

export function geoConfig(env: Record<string, string | undefined> = process.env): GeoConfig {
  const parsed = geoEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuration du géocodage invalide : ${names}`);
  }
  const e = parsed.data;
  const contact = [e.RADAR_CONTACT, e.AUTH_URL].find(
    (c) => c && /^\S{5,}$/.test(c) && !/[()]/.test(c),
  );
  return {
    enabled: e.GEO_ENABLED,
    userAgent: contact ? `${GEO_PRODUCT} (+${contact})` : null,
    banUrl: e.GEO_BAN_URL,
    nominatimEnabled: e.GEO_NOMINATIM_ENABLED,
    nominatimUrl: e.GEO_NOMINATIM_URL,
    nominatimMaxRequests: e.GEO_NOMINATIM_MAX_PER_RUN,
    timeoutMs: e.GEO_TIMEOUT_MS,
  };
}

/** Client HTTP du géocodage : délais courts, peu de nouvelles tentatives, débit par hôte. */
export function geoHttpClient(
  config: GeoConfig,
  deps: { fetch?: FetchLike; sleep?: (ms: number) => Promise<void> } = {},
): HttpClient | null {
  if (!config.enabled || !config.userAgent) return null;
  return new HttpClient({
    userAgent: config.userAgent,
    fetch: deps.fetch,
    sleep: deps.sleep,
    minIntervalMs: 100,
    hostIntervals: { [new URL(config.nominatimUrl).host]: NOMINATIM_MIN_INTERVAL_MS },
    maxRetries: 1,
    baseBackoffMs: 1000,
    maxBackoffMs: 5000,
    timeoutMs: config.timeoutMs,
  });
}

export function geoProviders(config: GeoConfig): GeocodingProvider[] {
  const providers = [banProvider({ baseUrl: config.banUrl })];
  if (config.nominatimEnabled && config.nominatimMaxRequests > 0) {
    providers.push(
      nominatimProvider({
        baseUrl: config.nominatimUrl,
        maxRequests: config.nominatimMaxRequests,
      }),
    );
  }
  return providers;
}

/**
 * Géocodeur prêt à l'emploi, ou `null` si le géocodage est désactivé (ou sans
 * contact pour le User-Agent). Un géocodeur par passage du radar : le quota
 * Nominatim et le disjoncteur repartent de zéro à chaque passage.
 */
export function createGeocoder(
  prisma: PrismaClient,
  config: GeoConfig,
  deps: {
    http?: HttpClient | null;
    fetch?: FetchLike;
    sleep?: (ms: number) => Promise<void>;
    now?: () => Date;
    logger?: Logger;
    store?: GeoCacheStore;
  } = {},
): Geocoder | null {
  const http = deps.http !== undefined ? deps.http : geoHttpClient(config, deps);
  if (!http) return null;
  return new Geocoder({
    http,
    providers: geoProviders(config),
    store: deps.store ?? prismaGeoCache(prisma),
    now: deps.now,
    logger: deps.logger,
  });
}
