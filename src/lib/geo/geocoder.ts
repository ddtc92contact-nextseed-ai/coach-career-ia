import type { PrismaClient } from "@/generated/prisma/client";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { HttpError, type HttpClient } from "@/lib/radar/http";
import { foldText } from "@/lib/radar/text";
import type { GeocodeOutcome, GeocodingProvider, GeoPrecision, GeoQuery, GeoResult } from "./types";

/**
 * Géocodeur : cache mémoire → cache persistant (`geo_cache`) → fournisseurs,
 * dans l'ordre. Ne lève JAMAIS : une panne renvoie `unavailable` et le
 * fournisseur fautif est mis de côté quelques minutes (disjoncteur), pour
 * qu'une source en panne ne ralentisse pas tout un passage du radar.
 *
 * Confidentialité : les requêtes peuvent venir des garde-fous d'un candidat.
 * Le lieu demandé et les coordonnées ne sont jamais journalisés : seuls le
 * nom du fournisseur, le type d'erreur et des compteurs le sont.
 */

/** Un « introuvable » est retenté après ce délai (le référentiel évolue). */
export const NOT_FOUND_TTL_MS = 30 * 24 * 3_600_000;

export type GeoCacheEntry = {
  found: boolean;
  latitude: number | null;
  longitude: number | null;
  country: string | null;
  precision: string | null;
  provider: string | null;
  updatedAt: Date;
};

export interface GeoCacheStore {
  get(key: string): Promise<GeoCacheEntry | null>;
  set(key: string, entry: Omit<GeoCacheEntry, "updatedAt">): Promise<void>;
}

export function prismaGeoCache(prisma: PrismaClient): GeoCacheStore {
  return {
    get: (key) => prisma.geoCache.findUnique({ where: { key } }),
    async set(key, entry) {
      await prisma.geoCache.upsert({
        where: { key },
        create: { key, ...entry },
        update: entry,
      });
    },
  };
}

/** Cache mémoire seul (tests, ou base indisponible). */
export function memoryGeoCache(now: () => Date = () => new Date()): GeoCacheStore & {
  entries: Map<string, GeoCacheEntry>;
} {
  const entries = new Map<string, GeoCacheEntry>();
  return {
    entries,
    get: async (key) => entries.get(key) ?? null,
    set: async (key, entry) => void entries.set(key, { ...entry, updatedAt: now() }),
  };
}

/** Clé normalisée : « fr|insee:69123||lyon ». Insensible à la casse et aux accents. */
export function geoCacheKey(query: GeoQuery): string {
  return [
    (query.country ?? "*").toLowerCase(),
    query.cityCode ? `insee:${query.cityCode.trim()}` : "",
    query.postalCode?.trim() ?? "",
    foldText(query.city),
  ].join("|");
}

export type GeocoderStats = {
  /** Requêtes envoyées aux fournisseurs. */
  requests: number;
  cacheHits: number;
  found: number;
  notFound: number;
  unavailable: number;
  providerErrors: number;
};

export type GeocoderOptions = {
  http: HttpClient;
  providers: GeocodingProvider[];
  store?: GeoCacheStore;
  now?: () => Date;
  logger?: Logger;
  /** Échecs consécutifs avant de mettre un fournisseur de côté. */
  failureThreshold?: number;
  cooldownMs?: number;
};

type ProviderHealth = { failures: number; disabledUntil: number };

export class Geocoder {
  private readonly memory = new Map<string, GeocodeOutcome>();
  private readonly health = new Map<string, ProviderHealth>();
  private readonly now: () => Date;
  private readonly log: Logger;
  private readonly store: GeoCacheStore | null;
  readonly stats: GeocoderStats = {
    requests: 0,
    cacheHits: 0,
    found: 0,
    notFound: 0,
    unavailable: 0,
    providerErrors: 0,
  };

  constructor(private readonly options: GeocoderOptions) {
    this.now = options.now ?? (() => new Date());
    this.log = options.logger ?? defaultLogger;
    this.store = options.store ?? null;
  }

  async geocode(query: GeoQuery): Promise<GeocodeOutcome> {
    const outcome = await this.resolve(query);
    if (outcome.status === "found") this.stats.found++;
    else if (outcome.status === "not_found") this.stats.notFound++;
    else this.stats.unavailable++;
    return outcome;
  }

  private async resolve(query: GeoQuery): Promise<GeocodeOutcome> {
    if (!query.city.trim()) return { status: "not_found" };
    const key = geoCacheKey(query);

    const remembered = this.memory.get(key);
    if (remembered) {
      this.stats.cacheHits++;
      return remembered;
    }
    const cached = await this.readCache(key);
    if (cached) {
      this.stats.cacheHits++;
      this.memory.set(key, cached);
      return cached;
    }

    const outcome = await this.askProviders(query);
    if (outcome.status !== "unavailable") {
      this.memory.set(key, outcome);
      await this.writeCache(key, outcome);
    }
    return outcome;
  }

  private async askProviders(query: GeoQuery): Promise<GeocodeOutcome> {
    let failed = false;
    for (const provider of this.options.providers) {
      if (!provider.supports(query.country) || !this.isHealthy(provider)) {
        if (provider.supports(query.country)) failed = true;
        continue;
      }
      try {
        this.stats.requests++;
        const result = await provider.geocode(query, this.options.http);
        this.health.delete(provider.name);
        if (result) return { status: "found", result };
        // Ex. la BAN pour une ville française : inutile de demander ailleurs.
        if (provider.authoritativeFor(query.country)) return { status: "not_found" };
      } catch (error) {
        failed = true;
        this.recordFailure(provider, error);
      }
    }
    return failed ? { status: "unavailable" } : { status: "not_found" };
  }

  /** Vrai si au moins un fournisseur pour ce pays peut encore être interrogé. */
  canServe(country: string | null): boolean {
    return this.options.providers.some((p) => p.supports(country) && this.isHealthy(p));
  }

  private isHealthy(provider: GeocodingProvider): boolean {
    const h = this.health.get(provider.name);
    return !h || h.disabledUntil <= this.now().getTime();
  }

  private recordFailure(provider: GeocodingProvider, error: unknown) {
    this.stats.providerErrors++;
    const h = this.health.get(provider.name) ?? { failures: 0, disabledUntil: 0 };
    h.failures++;
    const threshold = this.options.failureThreshold ?? 3;
    // Quota épuisé : inutile d'insister pendant ce passage.
    const exhausted = error instanceof Error && error.name === "NominatimBudgetExceeded";
    if (h.failures >= threshold || exhausted) {
      h.disabledUntil = this.now().getTime() + (this.options.cooldownMs ?? 10 * 60_000);
      h.failures = 0;
      this.log.warn("geo.provider.suspended", { provider: provider.name });
    }
    this.health.set(provider.name, h);
    // Jamais la requête ni l'URL (elle contient le lieu demandé).
    this.log.warn("geo.provider.failed", {
      provider: provider.name,
      error: error instanceof Error ? error.name : "erreur",
      ...(error instanceof HttpError ? { status: error.status } : {}),
    });
  }

  private async readCache(key: string): Promise<GeocodeOutcome | null> {
    if (!this.store) return null;
    try {
      const entry = await this.store.get(key);
      if (!entry) return null;
      if (entry.found && entry.latitude !== null && entry.longitude !== null) {
        return {
          status: "found",
          result: {
            latitude: entry.latitude,
            longitude: entry.longitude,
            country: entry.country,
            precision: (entry.precision ?? "municipality") as GeoPrecision,
            provider: "cache",
          },
        };
      }
      const expired = this.now().getTime() - entry.updatedAt.getTime() > NOT_FOUND_TTL_MS;
      return expired ? null : { status: "not_found" };
    } catch (error) {
      this.log.warn("geo.cache.read_failed", { error: error instanceof Error ? error.name : "" });
      return null;
    }
  }

  private async writeCache(key: string, outcome: GeocodeOutcome) {
    if (!this.store) return;
    const result: GeoResult | null = outcome.status === "found" ? outcome.result : null;
    try {
      await this.store.set(key, {
        found: result !== null,
        latitude: result?.latitude ?? null,
        longitude: result?.longitude ?? null,
        country: result?.country ?? null,
        precision: result?.precision ?? null,
        provider: result?.provider ?? null,
      });
    } catch (error) {
      this.log.warn("geo.cache.write_failed", { error: error instanceof Error ? error.name : "" });
    }
  }
}
