import type { PrismaClient } from "@/generated/prisma/client";

/**
 * Santé des sources du radar, calculée à partir de l'historique `SourceRun` :
 * dernier passage, compteurs, dernière erreur et nombre d'échecs consécutifs.
 * Une source est signalée quand ses `threshold` derniers passages terminés
 * ont tous échoué.
 */

export const DEFAULT_FAILURE_THRESHOLD = 3;

export type HealthRun = {
  source: string;
  sourceKey: string;
  status: "RUNNING" | "SUCCESS" | "FAILED";
  complete: boolean;
  startedAt: Date;
  finishedAt: Date | null;
  fetchedCount: number;
  createdCount: number;
  closedCount: number;
  duplicateCount: number;
  error: string | null;
};

export type SourceHealth = {
  source: string;
  sourceKey: string;
  lastRun: HealthRun;
  /** Dernier passage réussi parmi l'historique examiné. */
  lastSuccessAt: Date | null;
  lastError: { message: string; at: Date } | null;
  /** Échecs d'affilée depuis le dernier succès (passages en cours ignorés). */
  consecutiveFailures: number;
  failing: boolean;
};

/** Seuil lu dans `RADAR_HEALTH_FAILURE_THRESHOLD` (entier ≥ 1), sinon 3. */
export function failureThreshold(env: NodeJS.ProcessEnv = process.env): number {
  const value = Number.parseInt(env.RADAR_HEALTH_FAILURE_THRESHOLD ?? "", 10);
  return Number.isInteger(value) && value >= 1 && value <= 100 ? value : DEFAULT_FAILURE_THRESHOLD;
}

export function summarizeSourceHealth(
  runs: HealthRun[],
  threshold: number = DEFAULT_FAILURE_THRESHOLD,
): SourceHealth[] {
  const byKey = new Map<string, HealthRun[]>();
  for (const run of runs) {
    const list = byKey.get(run.sourceKey) ?? [];
    list.push(run);
    byKey.set(run.sourceKey, list);
  }

  const health: SourceHealth[] = [];
  for (const [sourceKey, list] of byKey) {
    list.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());
    let consecutiveFailures = 0;
    for (const run of list) {
      if (run.status === "RUNNING") continue;
      if (run.status !== "FAILED") break;
      consecutiveFailures++;
    }
    const lastSuccess = list.find((r) => r.status === "SUCCESS");
    const lastFailure = list.find((r) => r.error);
    health.push({
      source: list[0]!.source,
      sourceKey,
      lastRun: list[0]!,
      lastSuccessAt: lastSuccess?.startedAt ?? null,
      lastError: lastFailure?.error
        ? { message: lastFailure.error, at: lastFailure.startedAt }
        : null,
      consecutiveFailures,
      failing: consecutiveFailures >= threshold,
    });
  }

  // Sources en alerte d'abord, puis les plus en échec, puis par nom.
  return health.sort(
    (a, b) =>
      Number(b.failing) - Number(a.failing) ||
      b.consecutiveFailures - a.consecutiveFailures ||
      a.sourceKey.localeCompare(b.sourceKey),
  );
}

/**
 * Charge les `depth` derniers passages de chaque source (une requête, fenêtre
 * SQL) et en déduit leur santé.
 */
export async function loadSourceHealth(
  prisma: PrismaClient,
  options: { threshold?: number; depth?: number } = {},
): Promise<SourceHealth[]> {
  const threshold = options.threshold ?? DEFAULT_FAILURE_THRESHOLD;
  const depth = Math.max(options.depth ?? 20, threshold);
  const runs = await prisma.$queryRaw<HealthRun[]>`
    SELECT source,
           source_key      AS "sourceKey",
           status::text    AS status,
           complete,
           started_at      AS "startedAt",
           finished_at     AS "finishedAt",
           fetched_count   AS "fetchedCount",
           created_count   AS "createdCount",
           closed_count    AS "closedCount",
           duplicate_count AS "duplicateCount",
           error
    FROM (
      SELECT *, row_number() OVER (PARTITION BY source_key ORDER BY started_at DESC) AS rank
      FROM source_runs
    ) recent
    WHERE rank <= ${depth}
  `;
  return summarizeSourceHealth(runs, threshold);
}
