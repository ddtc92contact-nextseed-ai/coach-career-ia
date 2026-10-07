import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import type { AiClient } from "@/lib/ai/client";
import { isAiError } from "@/lib/ai/errors";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { loadCandidate, matchOfferSelect, toMatchOffer } from "./candidate";
import type { MatchingConfig } from "./config";
import { ensureMemoryEmbeddings, ensureOfferEmbeddings, memorySimilarities } from "./embeddings";
import { buildExplanation, explanationFacts } from "./explanation";
import { checkGuardRails } from "./filters";
import { rankOffers } from "./score";

/**
 * Recalcul des correspondances d'un candidat (exécuté par le worker) :
 * 1. garde-fous sur toutes les offres ouvertes et canoniques ;
 * 2. embeddings (offres qualifiées et réalisations), en cache pgvector ;
 * 3. score, puis explication — régénérée seulement si ses éléments changent ;
 * 4. suppression des correspondances devenues hors garde-fous.
 * Sans IA disponible, le score repose sur les compétences citées et
 * l'explication est déterministe : le recalcul n'échoue pas pour autant.
 */

export type RecomputeDeps = {
  config: Pick<
    MatchingConfig,
    "minScore" | "maxPerUser" | "llmExplanations" | "llmMinScore" | "semanticRange"
  >;
  /** `null` : pas d'IA (score lexical, explications déterministes). */
  client: AiClient | null;
  /** Appels LLM restants pour ce passage, partagé entre candidats. */
  llmBudget: { remaining: number };
  now?: () => Date;
  logger?: Logger;
};

export type RecomputeSummary =
  | { status: "skipped"; reason: "noMemory" | "noGuardRails"; removed: number }
  | {
      status: "done";
      offers: number;
      excluded: number;
      stored: number;
      unchanged: number;
      removed: number;
      llm: number;
      semantic: boolean;
    };

const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("base64url");

export async function recomputeUserMatches(
  prisma: PrismaClient,
  userId: string,
  deps: RecomputeDeps,
): Promise<RecomputeSummary> {
  const log = deps.logger ?? defaultLogger;
  const now = (deps.now ?? (() => new Date()))();
  const status = await loadCandidate(prisma, userId);

  if (!status.eligible) {
    // Sans mémoire ni garde-fous, plus rien n'est garanti : seules les
    // correspondances sauvegardées ou écartées par le candidat restent (masquées).
    const { count } = await prisma.match.deleteMany({
      where: { userId, status: { in: ["NEW", "SEEN"] } },
    });
    return { status: "skipped", reason: status.reason, removed: count };
  }
  const { profile, rails, locale } = status.candidate;

  const rows = await prisma.jobOffer.findMany({
    where: { status: "OPEN", duplicateOfId: null },
    select: matchOfferSelect,
  });
  const offers = rows.map(toMatchOffer);
  const passing = offers.filter((offer) => checkGuardRails(offer, rails).pass);

  // --- Similarités sémantiques (facultatives) ---
  let similarities: Map<string, Map<string, number>> | null = null;
  if (deps.client && profile.achievements.length > 0 && passing.length > 0) {
    try {
      const hashes = await ensureMemoryEmbeddings(
        prisma,
        deps.client,
        userId,
        profile.achievements.map((a) => a.text),
      );
      await ensureOfferEmbeddings(prisma, deps.client, passing);
      const byHash = await memorySimilarities(
        prisma,
        userId,
        deps.client.provider.embeddingModel,
        passing.map((o) => o.id),
      );
      similarities = new Map(
        passing.map((offer) => {
          const sims = byHash.get(offer.id);
          const byAchievement = new Map<string, number>();
          profile.achievements.forEach((a, i) => {
            const sim = sims?.get(hashes[i]!);
            if (sim !== undefined) byAchievement.set(a.id, sim);
          });
          return [offer.id, byAchievement];
        }),
      );
    } catch (error) {
      log.warn("matching.embeddings.unavailable", {
        code: isAiError(error) ? error.code : error instanceof Error ? error.name : "erreur",
      });
      similarities = null;
    }
  }

  const { matches, excluded } = rankOffers(
    profile,
    rails,
    passing,
    similarities,
    deps.config.semanticRange,
  );
  const offerById = new Map(passing.map((o) => [o.id, o]));
  const existing = await prisma.match.findMany({
    where: { userId },
    select: { offerId: true, inputHash: true, status: true },
  });
  const existingByOffer = new Map(existing.map((m) => [m.offerId, m]));

  // Retenues : les meilleures au-dessus du seuil, plus celles que le candidat
  // a sauvegardées ou écartées tant que l'offre respecte ses garde-fous.
  const pinned = new Set(
    existing.filter((m) => m.status === "SAVED" || m.status === "DISMISSED").map((m) => m.offerId),
  );
  const top = new Set(
    matches
      .filter((m) => m.score >= deps.config.minScore)
      .slice(0, deps.config.maxPerUser)
      .map((m) => m.offerId),
  );
  const kept = matches.filter((m) => top.has(m.offerId) || pinned.has(m.offerId));

  let stored = 0;
  let unchanged = 0;
  let llm = 0;
  for (const match of kept) {
    const offer = offerById.get(match.offerId)!;
    const facts = explanationFacts(match);
    const inputHash = hash({ v: 1, locale, title: offer.title, score: match.score, facts });
    if (existingByOffer.get(match.offerId)?.inputHash === inputHash) {
      unchanged++;
      continue;
    }
    const useLlm =
      deps.client !== null &&
      deps.config.llmExplanations &&
      match.score >= deps.config.llmMinScore &&
      deps.llmBudget.remaining > 0;
    if (useLlm) deps.llmBudget.remaining--;
    const explanation = await buildExplanation(
      { offerTitle: offer.title, score: match.score, facts, locale },
      useLlm ? deps.client : null,
      { onError: (code) => log.warn("matching.explain.fallback", { code }) },
    );
    if (explanation.source === "llm") llm++;
    await prisma.match.upsert({
      where: { userId_offerId: { userId, offerId: match.offerId } },
      create: {
        userId,
        offerId: match.offerId,
        score: match.score,
        explanation,
        inputHash,
        computedAt: now,
      },
      update: { score: match.score, explanation, inputHash, computedAt: now },
    });
    stored++;
  }

  // Tout le reste disparaît : offre fermée, devenue doublon, hors garde-fous ou sous le seuil.
  const { count: removed } = await prisma.match.deleteMany({
    where: { userId, offerId: { notIn: kept.map((m) => m.offerId) } },
  });

  return {
    status: "done",
    offers: offers.length,
    excluded: offers.length - passing.length + excluded.length,
    stored,
    unchanged,
    removed,
    llm,
    semantic: similarities !== null,
  };
}
