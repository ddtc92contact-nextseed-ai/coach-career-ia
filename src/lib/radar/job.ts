import type { PrismaClient } from "@/generated/prisma/client";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { loadCompanyConfig, syncCompanies } from "./companies";
import type { AtsCompany } from "./connectors/ats";
import { ashbyConnector } from "./connectors/ashby";
import { franceTravailConnector } from "./connectors/france-travail";
import { greenhouseConnector } from "./connectors/greenhouse";
import { leverConnector } from "./connectors/lever";
import type { RadarConfig } from "./config";
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
  }
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
};

/** Un passage complet du radar : toutes les sources, l'une après l'autre. */
export async function runRadar(
  prisma: PrismaClient,
  config: RadarConfig,
  deps: RadarDeps = {},
): Promise<RunSummary[]> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const http =
    deps.http ??
    new HttpClient({
      userAgent: config.userAgent,
      minIntervalMs: config.minIntervalMs,
      fetch: deps.fetch,
      sleep: deps.sleep,
    });

  const companies = await syncCompanies(prisma, await loadCompanyConfig(config.companiesFile));
  if (!config.franceTravail) {
    log.warn("radar.france_travail.disabled", { reason: "identifiants absents" });
  }
  const connectors = buildConnectors(config, companies);
  log.info("radar.started", { connectors: connectors.length });

  const summaries = await runConnectors(prisma, connectors, {
    http,
    now,
    allowedCountries: config.countries,
    logger: log,
  });
  const failed = summaries.filter((s) => s.status === "FAILED").length;
  log.info("radar.finished", {
    connectors: summaries.length,
    failed,
    created: summaries.reduce((n, s) => n + s.created, 0),
    closed: summaries.reduce((n, s) => n + s.closed, 0),
  });
  return summaries;
}
