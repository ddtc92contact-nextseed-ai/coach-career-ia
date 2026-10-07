/**
 * Worker de tâches de fond (placeholder).
 *
 * Accueillera les traitements asynchrones à venir (collecte d'offres,
 * matching, notifications e-mail). Pour l'instant il signale qu'il est
 * vivant et s'arrête proprement sur SIGTERM / SIGINT.
 */
const HEARTBEAT_MS = 60_000;

function log(level, event) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, event, service: "worker" }));
}

log("info", "worker.started");
const timer = setInterval(() => log("debug", "worker.heartbeat"), HEARTBEAT_MS);

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => {
    clearInterval(timer);
    log("info", "worker.stopped");
    process.exit(0);
  });
}
