import type { PrismaClient } from "@/generated/prisma/client";
import { createGeocoder, type Geocoder } from "@/lib/geo";
import { backfillOfferCoordinates } from "@/lib/geo/offers";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { loadCompanyConfig, syncCompanies } from "./companies";
import type { AtsCompany } from "./connectors/ats";
import { ashbyConnector } from "./connectors/ashby";
import { franceTravailConnector } from "./connectors/france-travail";
import { greenhouseConnector } from "./connectors/greenhouse";
import { leverConnector } from "./connectors/lever";
import { recruiteeConnector } from "./connectors/recruitee";
import { smartRecruitersConnector } from "./connectors/smartrecruiters";
import { workableConnector } from "./connectors/workable";
import type { RadarConfig } from "./config";
import { failureThreshold, loadSourceHealth } from "./health";
import { HttpClient, type FetchLike } from "./http";
import { runConnectors, type RunSummary } from "./pipeline";
import type { Connector } from "./types";

export function atsConnector(company: AtsCompany): Connector<unknown> {
  switch (company.atsType) {
    case "GREENHOUSE":
      return greenhouseConnector(company) as Connector<unknown>;
    case "LEVER":
      return leverConnector(company) as Connector<unknown>;
    case "ASHBY":
      return ashbyConnector(company) as Connector<unknown>;
    case "SMARTRECRUITERS":
      return smartRecruitersConnector(company) as Connector<unknown>;
    case "RECRUITEE":
      return recruiteeConnector(company) as Connector<unknown>;
    case "WORKABLE":
      return workableConnector(company) as Connector<unknown>;
  }
}

/**
 * Intervalles minimaux par hôte, au-delà de `RADAR_MIN_INTERVAL_MS` :
 * `apply.workable.com` répond 429 dès quelques requêtes par seconde.
 */
export const HOST_INTERVALS: Record<string, number> = {
  "apply.workable.com": 5000,
};

/** Client HTTP du radar (job ponctuel et worker). */
export function radarHttpClient(
  config: Pick<RadarConfig, "userAgent" | "minIntervalMs">,
  deps: Pick<RadarDeps, "fetch" | "sleep"> = {},
): HttpClient {
  const hostIntervals = Object.fromEntries(
    Object.entries(HOST_INTERVALS).map(([host, ms]) => [host, Math.max(ms, config.minIntervalMs)]),
  );
  return new HttpClient({
    userAgent: config.userAgent,
    minIntervalMs: config.minIntervalMs,
    hostIntervals,
    fetch: deps.fetch,
    sleep: deps.sleep,
  });
}

export function buildConnectors(
  config: RadarConfig,
  companies: AtsCompany[],
): Connector<unknown>[] {
  const connectors: Connector<unknown>[] = [];
  if (config.franceTravail) {
    const { clientId, clientSecret, ...criteria } = config.franceTravail;
    connectors.push(
      franceTravailConnector({ clientId, clientSecret }, criteria) as Connector<unknown>,
    );
  }
  connectors.push(...companies.map(atsConnector));
  return connectors;
}

export type RadarDeps = {
  fetch?: FetchLike;
  sleep?: (ms: number) => Promise<void>;
  now?: () => Date;
  logger?: Logger;
  /** Client HTTP partagé entre passages (cache conditionnel conservé). */
  http?: HttpClient;
  /** Géocodeur injecté (tests) ; `null` le désactive. Défaut : selon `config.geo`. */
  geocoder?: Geocoder | null;
};

/** Un passage complet du radar : toutes les sources, l'une après l'autre. */
export async function runRadar(
  prisma: PrismaClient,
  config: RadarConfig,
  deps: RadarDeps = {},
): Promise<RunSummary[]> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const http = deps.http ?? radarHttpClient(config, deps);

  const companies = await syncCompanies(prisma, await loadCompanyConfig(config.companiesFile));
  if (!config.franceTravail) {
    log.warn("radar.france_travail.disabled", { reason: "identifiants absents" });
  }
  const connectors = buildConnectors(config, companies);
  log.info("radar.started", { connectors: connectors.length });

  const geocoder =
    deps.geocoder !== undefined
      ? deps.geocoder
      : config.geo
        ? createGeocoder(prisma, config.geo, {
            fetch: deps.fetch,
            sleep: deps.sleep,
            now,
            logger: log,
          })
        : null;
  if (!geocoder) log.warn("radar.geo.disabled", { reason: "géocodage désactivé ou sans contact" });

  const summaries = await runConnectors(prisma, connectors, {
    http,
    now,
    allowedCountries: config.countries,
    logger: log,
    geocoder,
  });

  // Rattrapage des offres ouvertes encore sans géocodage (offres anciennes,
  // sources inactives, géocodeur indisponible lors d'un passage précédent).
  if (geocoder) {
    try {
      await backfillOfferCoordinates(prisma, geocoder, { now, logger: log });
    } catch (error) {
      log.error("radar.geo.backfill_failed", {
        error: error instanceof Error ? error.name : "erreur",
      });
    }
  }
  // Alerte quand une source échoue plusieurs passages d'affilée (voir /app/radar).
  try {
    for (const source of await loadSourceHealth(prisma, { threshold: failureThreshold() })) {
      if (!source.failing) continue;
      log.warn("radar.source.unhealthy", {
        sourceKey: source.sourceKey,
        consecutiveFailures: source.consecutiveFailures,
      });
    }
  } catch (error) {
    log.error("radar.health.failed", { error: error instanceof Error ? error.name : "erreur" });
  }

  const failed = summaries.filter((s) => s.status === "FAILED").length;
  log.info("radar.finished", {
    connectors: summaries.length,
    failed,
    created: summaries.reduce((n, s) => n + s.created, 0),
    closed: summaries.reduce((n, s) => n + s.closed, 0),
  });
  return summaries;
}
