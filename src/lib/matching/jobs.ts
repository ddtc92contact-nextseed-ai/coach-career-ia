import type { PrismaClient } from "@/generated/prisma/client";
import type { AiClient } from "@/lib/ai/client";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import type { MatchingConfig } from "./config";
import { recomputeUserMatches } from "./recompute";

/**
 * Déclenchement du recalcul : toute modification de la mémoire de carrière
 * ou des garde-fous (et l'arrivée de nouvelles offres) marque le candidat
 * « à recalculer » (`matching_states.dirty_at`). Le worker recalcule quand
 * plus rien n'a changé depuis `debounceMs` : une série de modifications ne
 * déclenche qu'un calcul. Jamais au chargement d'une page.
 */

/** Demande un recalcul pour un candidat (repousse le délai d'attente). */
export async function markMatchingDirty(prisma: PrismaClient, userId: string, now = new Date()) {
  await prisma.matchingState.upsert({
    where: { userId },
    create: { userId, dirtyAt: now },
    update: { dirtyAt: now },
  });
}

/**
 * Nouvelles offres (ou offres modifiées, fermées) : recalcul de tous les
 * candidats qui ont des garde-fous. Renvoie le nombre de candidats marqués.
 */
export async function markAllCandidatesDirty(prisma: PrismaClient, now = new Date()) {
  return prisma.$executeRaw`
    INSERT INTO matching_states (user_id, dirty_at, updated_at)
    SELECT user_id, ${now}, ${now} FROM guard_rails
    ON CONFLICT (user_id) DO UPDATE SET dirty_at = EXCLUDED.dirty_at, updated_at = EXCLUDED.updated_at`;
}

export type MatchingCycleDeps = {
  config: MatchingConfig;
  client: AiClient | null;
  now?: () => Date;
  logger?: Logger;
};

export type MatchingCycleSummary = { processed: number; failed: number; llm: number };

/** Un passage : recalcule les candidats en attente depuis plus de `debounceMs`. */
export async function runMatchingCycle(
  prisma: PrismaClient,
  deps: MatchingCycleDeps,
): Promise<MatchingCycleSummary> {
  const log = deps.logger ?? defaultLogger;
  const now = deps.now ?? (() => new Date());
  const settled = new Date(now().getTime() - deps.config.debounceMs);
  const due = await prisma.matchingState.findMany({
    where: { dirtyAt: { not: null, lte: settled } },
    orderBy: { dirtyAt: "asc" },
    take: deps.config.usersPerRun,
    select: { userId: true, dirtyAt: true },
  });
  const llmBudget = { remaining: deps.config.llmMaxPerRun };
  const summary: MatchingCycleSummary = { processed: 0, failed: 0, llm: 0 };

  for (const { userId, dirtyAt } of due) {
    const started = Date.now();
    try {
      const result = await recomputeUserMatches(prisma, userId, {
        config: deps.config,
        client: deps.client,
        llmBudget,
        now,
        logger: log,
      });
      // Nettoyé seulement si rien n'a changé pendant le calcul ; sinon le
      // candidat reste en attente et sera recalculé au prochain passage.
      await prisma.matchingState.updateMany({
        where: { userId, dirtyAt },
        data: { dirtyAt: null, computedAt: now() },
      });
      summary.processed++;
      if (result.status === "done") summary.llm += result.llm;
      // Compteurs seulement : aucune donnée du candidat ni des offres.
      log.info("matching.user.done", {
        ...result,
        durationMs: Date.now() - started,
      });
    } catch (error) {
      summary.failed++;
      // Réessai au prochain passage (après le délai d'attente).
      await prisma.matchingState
        .updateMany({ where: { userId, dirtyAt }, data: { dirtyAt: now() } })
        .catch(() => undefined);
      log.error("matching.user.failed", {
        error: error instanceof Error ? error.name : "erreur",
      });
    }
  }
  if (due.length > 0) log.info("matching.cycle.finished", { ...summary });
  return summary;
}
