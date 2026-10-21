import type { PrismaClient } from "@/generated/prisma/client";
import { createGeocoder, type Geocoder } from "@/lib/geo";
import { backfillOfferCoordinates } from "@/lib/geo/offers";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { loadCompanyConfig, loadWatchedCompanies, syncCompanies } from "./companies";
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
import { beginPass, finishPass } from "./passes";
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
  config: Pick<RadarConfig, "userAgent" | "minIntervalMs" | "httpCacheBytes">,
  deps: Pick<RadarDeps, "fetch" | "sleep"> = {},
): HttpClient {
  const hostIntervals = Object.fromEntries(
    Object.entries(HOST_INTERVALS).map(([host, ms]) => [host, Math.max(ms, config.minIntervalMs)]),
  );
  return new HttpClient({
    userAgent: config.userAgent,
    minIntervalMs: config.minIntervalMs,
    hostIntervals,
    cacheMaxBytes: config.httpCacheBytes,
    fetch: deps.fetch,
    sleep: deps.sleep,
  });
}

/**
 * Alterne les ATS (Greenhouse, Lever, Ashby…) en gardant l'ordre au sein de
 * chacun : deux requêtes consécutives visent rarement le même hôte, si bien
 * que l'intervalle minimal par hôte (1 s, 5 s pour Workable) s'écoule pendant
 * la collecte des autres boards au lieu de s'additionner.
 */
export function interleaveByAts(companies: AtsCompany[]): AtsCompany[] {
  const groups = new Map<string, AtsCompany[]>();
  for (const company of companies) {
    const key = `${company.atsType}:${company.atsRegion ?? ""}`;
    const group = groups.get(key) ?? [];
    group.push(company);
    groups.set(key, group);
  }
  const queues = [...groups.values()];
  const ordered: AtsCompany[] = [];
  for (let i = 0; ordered.length < companies.length; i++) {
    for (const queue of queues) if (i < queue.length) ordered.push(queue[i]!);
  }
  return ordered;
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
  connectors.push(...interleaveByAts(companies).map(atsConnector));
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

  // Un passage à la fois (worker et `npm run radar:run` peuvent coexister).
  const pass = await beginPass(prisma, now());
  if (!pass) {
    log.warn("radar.pass.skipped", { reason: "un passage est déjà en cours" });
    return [];
  }
  try {
    const summaries = await collect(prisma, config, { ...deps, http, now, logger: log });
    const { durationMs, bySource } = await finishPass(prisma, pass, summaries, now());
    for (const [source, counts] of Object.entries(bySource)) {
      log.info("radar.finished.source", { source, ...counts });
    }
    log.info("radar.finished", {
      durationMs,
      connectors: summaries.length,
      failed: summaries.filter((s) => s.status === "FAILED").length,
      created: summaries.reduce((n, s) => n + s.created, 0),
      closed: summaries.reduce((n, s) => n + s.closed, 0),
    });
    return summaries;
  } catch (error) {
    await prisma.radarPass
      .update({ where: { id: pass.id }, data: { status: "INTERRUPTED", finishedAt: now() } })
      .catch(() => undefined);
    throw error;
  }
}

async function collect(
  prisma: PrismaClient,
  config: RadarConfig,
  deps: RadarDeps & Required<Pick<RadarDeps, "http" | "now" | "logger">>,
): Promise<RunSummary[]> {
  const { http, now, logger: log } = deps;

  // Liste de référence d'abord, puis l'union avec les entreprises suivies par les candidats.
  // Ordre de la liste de référence conservé (ATS alternés), chaque board une seule fois.
  const reference = await syncCompanies(prisma, await loadCompanyConfig(config.companiesFile));
  const known = new Set(reference.map((c) => c.id));
  const companies = [
    ...reference,
    ...(await loadWatchedCompanies(prisma)).filter((c) => !known.has(c.id)),
  ];
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

  return summaries;
}
