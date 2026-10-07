/**
 * Worker de tâches de fond : exécute le Market Radar toutes les
 * `RADAR_INTERVAL_HOURS` heures (6 par défaut), un passage à la fois.
 * Le même client HTTP est conservé entre passages : les requêtes
 * conditionnelles (ETag / Last-Modified) évitent de retélécharger un board
 * inchangé. Arrêt propre sur SIGTERM / SIGINT.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createLogger } from "../src/lib/logger";
import { radarConfig, type RadarConfig } from "../src/lib/radar/config";
import { HttpClient } from "../src/lib/radar/http";
import { runRadar } from "../src/lib/radar/job";

const log = createLogger();
let timer: NodeJS.Timeout | undefined;
let stopping = false;

function start(config: RadarConfig) {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  const http = new HttpClient({ userAgent: config.userAgent, minIntervalMs: config.minIntervalMs });
  const intervalMs = config.intervalHours * 3_600_000;

  const tick = async () => {
    try {
      await runRadar(prisma, config, { http, logger: log });
    } catch (error) {
      log.error("worker.radar.failed", { error: error instanceof Error ? error : String(error) });
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

  for (const signal of ["SIGTERM", "SIGINT"] as const) {
    process.on(signal, () => {
      stopping = true;
      clearTimeout(timer);
      log.info("worker.stopped", { signal });
      void prisma.$disconnect().finally(() => process.exit(0));
    });
  }
}

try {
  start(radarConfig());
} catch (error) {
  // Configuration incomplète : on le signale clairement et on s'arrête.
  log.error("worker.config.invalid", { error: error instanceof Error ? error : String(error) });
  process.exit(1);
}
