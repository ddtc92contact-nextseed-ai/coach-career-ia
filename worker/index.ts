/**
 * Worker de tâches de fond :
 * - Market Radar toutes les `RADAR_INTERVAL_HOURS` heures (6 par défaut), un
 *   passage à la fois. Le même client HTTP est conservé entre passages : les
 *   requêtes conditionnelles (ETag / Last-Modified) évitent de retélécharger
 *   un board inchangé. Chaque passage recalcule ensuite les signaux faibles
 *   des entreprises et demande le recalcul des opportunités ;
 * - matching toutes les `MATCHING_POLL_SECONDS` secondes : recalcul des
 *   candidats en attente (regroupé), puis envoi des alertes e-mail dues.
 * Arrêt propre sur SIGTERM / SIGINT.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { aiClientFromEnv } from "../src/lib/ai/config";
import type { AiClient } from "../src/lib/ai/client";
import { createLogger } from "../src/lib/logger";
import { smtpSender, smtpSettingsFromEnv } from "../src/lib/mail/smtp";
import { runAlerts } from "../src/lib/matching/alerts";
import { matchingConfig, type MatchingConfig } from "../src/lib/matching/config";
import { markAllCandidatesDirty, runMatchingCycle } from "../src/lib/matching/jobs";
import { radarConfig, type RadarConfig } from "../src/lib/radar/config";
import { radarHttpClient, runRadar } from "../src/lib/radar/job";
import { runCompanySignals } from "../src/lib/radar/signals/job";

const log = createLogger();
let timer: NodeJS.Timeout | undefined;
let matchingTimer: NodeJS.Timeout | undefined;
let stopping = false;

/** Client IA du matching, ou `null` (pas de fournisseur configuré : score et explications sans IA). */
function matchingAiClient(): AiClient | null {
  try {
    return aiClientFromEnv();
  } catch {
    log.warn("worker.matching.ai_disabled", { reason: "fournisseur IA non configuré" });
    return null;
  }
}

function startMatching(prisma: PrismaClient, config: MatchingConfig) {
  if (!config.enabled) {
    log.warn("worker.matching.disabled", { reason: "MATCHING_ENABLED=false" });
    return;
  }
  const client = matchingAiClient();
  const send = smtpSender(smtpSettingsFromEnv());
  if (!send || !config.appUrl) {
    log.warn("worker.alerts.disabled", {
      reason: !send ? "SMTP non configuré" : "APP_URL / AUTH_URL absent",
    });
  }
  const tick = async () => {
    try {
      await runMatchingCycle(prisma, { config, client, logger: log });
      if (send && config.appUrl) {
        await runAlerts(prisma, { send, appUrl: config.appUrl, logger: log });
      }
    } catch (error) {
      log.error("worker.matching.failed", {
        error: error instanceof Error ? error : String(error),
      });
    }
    if (!stopping) matchingTimer = setTimeout(tick, config.pollMs);
  };
  matchingTimer = setTimeout(tick, 0);
}

function start(config: RadarConfig, matching: MatchingConfig) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  const http = radarHttpClient(config);
  const intervalMs = config.intervalHours * 3_600_000;

  const tick = async () => {
    try {
      await runRadar(prisma, config, { http, logger: log });
      // Offres nouvelles, modifiées, fermées ou géolocalisées : recalcul (regroupé).
      await markAllCandidatesDirty(prisma);
    } catch (error) {
      log.error("worker.radar.failed", { error: error instanceof Error ? error : String(error) });
    }
    try {
      // Signaux faibles (pic, gel, nouvelle équipe…) dérivés des offres collectées.
      await runCompanySignals(prisma, { logger: log });
    } catch (error) {
      log.error("worker.signals.failed", { error: error instanceof Error ? error : String(error) });
    }
    if (!stopping) timer = setTimeout(tick, intervalMs);
  };

  log.info("worker.started", {
    intervalHours: config.intervalHours,
    runOnStart: config.runOnStart,
  });

  // Un passage interrompu (redémarrage du conteneur) resterait sinon « en cours ».
  void prisma.sourceRun
    .updateMany({
      where: { status: "RUNNING" },
      data: {
        status: "FAILED",
        error: "Interrompu (redémarrage du worker)",
        finishedAt: new Date(),
      },
    })
    .catch(() => undefined)
    .then(() => {
      if (!stopping) timer = setTimeout(tick, config.runOnStart ? 0 : intervalMs);
    });
  startMatching(prisma, matching);

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      stopping = true;
      clearTimeout(timer);
      clearTimeout(matchingTimer);
      log.info("worker.stopped", { signal });
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  }
}

try {
  start(radarConfig(), matchingConfig());
} catch (error) {
  // Configuration incomplète : on le signale clairement et on s'arrête.
  log.error("worker.config.invalid", { error: error instanceof Error ? error : String(error) });
  process.exit(1);
}
