import type { PrismaClient } from "@/generated/prisma/client";
import type { RunSummary } from "./pipeline";

/**
 * Passages du radar (`RadarPass`) : un seul à la fois, même si le worker et
 * `npm run radar:run` tournent ensemble. Avec ~500 boards et 1 s minimum
 * entre deux requêtes vers un même hôte, un passage dure une dizaine de
 * minutes : sa durée et ses compteurs par source sont affichés sur /app/radar.
 */

/** Au-delà, un passage encore « en cours » est considéré comme abandonné (processus tué). */
export const STALE_PASS_MS = 6 * 3_600_000;

/** Clé du verrou consultatif PostgreSQL qui sérialise le démarrage des passages. */
const PASS_LOCK_KEY = 61_000_061;

export type SourceCounts = {
  sources: number;
  failed: number;
  fetched: number;
  created: number;
  closed: number;
};

/** Compteurs par source (`france_travail`, `greenhouse`…) d'un passage. */
export function countsBySource(summaries: RunSummary[]): Record<string, SourceCounts> {
  const counts: Record<string, SourceCounts> = {};
  for (const s of summaries) {
    const c = (counts[s.source] ??= { sources: 0, failed: 0, fetched: 0, created: 0, closed: 0 });
    c.sources++;
    if (s.status === "FAILED") c.failed++;
    c.fetched += s.fetched;
    c.created += s.created;
    c.closed += s.closed;
  }
  return counts;
}

/**
 * Ouvre un passage, ou renvoie `null` si un autre est déjà en cours. Un
 * passage resté « en cours » plus de `STALE_PASS_MS` est clos comme
 * interrompu. Vérification et création se font sous verrou : deux processus
 * qui démarrent ensemble ne lancent jamais deux passages.
 */
export async function beginPass(
  prisma: PrismaClient,
  startedAt: Date,
): Promise<{ id: string; startedAt: Date } | null> {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${PASS_LOCK_KEY})`;
    await tx.radarPass.updateMany({
      where: {
        status: "RUNNING",
        startedAt: { lt: new Date(startedAt.getTime() - STALE_PASS_MS) },
      },
      data: { status: "INTERRUPTED", finishedAt: startedAt },
    });
    if (await tx.radarPass.findFirst({ where: { status: "RUNNING" }, select: { id: true } })) {
      return null;
    }
    return tx.radarPass.create({ data: { startedAt }, select: { id: true, startedAt: true } });
  });
}

export async function finishPass(
  prisma: PrismaClient,
  pass: { id: string; startedAt: Date },
  summaries: RunSummary[],
  finishedAt: Date,
): Promise<{ durationMs: number; bySource: Record<string, SourceCounts> }> {
  const bySource = countsBySource(summaries);
  const total = (key: keyof SourceCounts) =>
    Object.values(bySource).reduce((n, c) => n + c[key], 0);
  const durationMs = Math.max(0, finishedAt.getTime() - pass.startedAt.getTime());
  await prisma.radarPass.update({
    where: { id: pass.id },
    data: {
      status: "FINISHED",
      finishedAt,
      durationMs,
      sources: total("sources"),
      failed: total("failed"),
      fetched: total("fetched"),
      created: total("created"),
      closed: total("closed"),
      bySource,
    },
  });
  return { durationMs, bySource };
}

/** Passages laissés « en cours » par un worker arrêté (au redémarrage). */
export async function interruptRunningPasses(prisma: PrismaClient, at: Date): Promise<number> {
  const { count } = await prisma.radarPass.updateMany({
    where: { status: "RUNNING" },
    data: { status: "INTERRUPTED", finishedAt: at },
  });
  return count;
}

/** Derniers passages, pour /app/radar. */
export async function loadRecentPasses(prisma: PrismaClient, take = 5) {
  const rows = await prisma.radarPass.findMany({ orderBy: { startedAt: "desc" }, take });
  return rows.map((row) => ({
    ...row,
    bySource: (row.bySource ?? {}) as Record<string, SourceCounts>,
  }));
}

/** « 9 min 42 s », « 48 s », « 1 h 05 min ». */
export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ${String(seconds % 60).padStart(2, "0")} s`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")} min`;
}
