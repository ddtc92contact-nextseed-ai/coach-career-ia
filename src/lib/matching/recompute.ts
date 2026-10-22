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
import { prefilteredOfferIds } from "./prefilter";
import { byRank, rankOffers, type OfferResult } from "./score";

/**
 * Recalcul des correspondances d'un candidat (exécuté par le worker) :
 * 1. garde-fous sur toutes les offres ouvertes et canoniques : pré-filtre SQL
 *    (sans lire les descriptions), puis garde-fous complets par lots ;
 * 2. embeddings (offres qualifiées et réalisations), en cache pgvector ;
 * 3. score, puis explication — régénérée seulement si ses éléments changent ;
 * 4. suppression des correspondances devenues hors garde-fous.
 * Sans IA disponible, le score repose sur les compétences citées et
 * l'explication est déterministe : le recalcul n'échoue pas pour autant.
 *
 * Mémoire (issue #64) : les offres sont lues par lots de `OFFER_BATCH_SIZE`
 * et seules les correspondances encore retenables (meilleures, sauvegardées,
 * écartées) sont gardées d'un lot à l'autre, sans description. Le tas reste
 * borné quel que soit le nombre d'offres en base.
 */

/** Offres lues (avec leur description) par lot. */
export const OFFER_BATCH_SIZE = 500;

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
  /** Taille des lots d'offres (tests). */
  batchSize?: number;
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

type Ranked = { match: Extract<OfferResult, { pass: true }>; title: string };

/** Échec du calcul des similarités (fournisseur d'embeddings, pgvector). */
class SemanticUnavailable extends Error {
  constructor(readonly reason: unknown) {
    super("embeddings indisponibles");
  }
}

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
  const batchSize = deps.batchSize ?? OFFER_BATCH_SIZE;

  const [total, followedRows, existing, ids] = await Promise.all([
    prisma.jobOffer.count({ where: { status: "OPEN", duplicateOfId: null } }),
    prisma.followedCompany.findMany({ where: { userId }, select: { companyId: true } }),
    prisma.match.findMany({
      where: { userId },
      select: { offerId: true, inputHash: true, status: true },
    }),
    prefilteredOfferIds(prisma, rails),
  ]);
  // Entreprises suivies : bonus de classement, après les garde-fous.
  const followed = new Set(followedRows.map((f) => f.companyId));
  const existingByOffer = new Map(existing.map((m) => [m.offerId, m]));
  // Retenues : les meilleures au-dessus du seuil, plus celles que le candidat
  // a sauvegardées ou écartées tant que l'offre respecte ses garde-fous.
  const pinned = new Set(
    existing.filter((m) => m.status === "SAVED" || m.status === "DISMISSED").map((m) => m.offerId),
  );
  const retain = (ranked: Ranked[]) => {
    ranked.sort((a, b) => byRank(a.match, b.match));
    let top = 0;
    return ranked.filter(({ match }) => {
      const isTop = match.score >= deps.config.minScore && top < deps.config.maxPerUser;
      if (isTop) top++;
      return isTop || pinned.has(match.offerId);
    });
  };

  /**
   * Parcours par lots des offres pré-filtrées : seules les descriptions d'un
   * lot sont en mémoire, et seules les offres encore « retenables » sont
   * gardées d'un lot à l'autre (sans leur description).
   */
  const scan = async (semantic: boolean) => {
    let kept: Ranked[] = [];
    let passingCount = 0;
    let excludedCount = 0;
    let hashes: string[] | null = null;
    for (let i = 0; i < ids.length; i += batchSize) {
      const rows = await prisma.jobOffer.findMany({
        where: { id: { in: ids.slice(i, i + batchSize) } },
        select: matchOfferSelect,
      });
      const passing = rows.map(toMatchOffer).filter((offer) => checkGuardRails(offer, rails).pass);
      passingCount += passing.length;
      if (passing.length === 0) continue;

      // --- Similarités sémantiques (facultatives) ---
      let similarities: Map<string, Map<string, number>> | null = null;
      if (semantic && deps.client) {
        const client = deps.client;
        const byHash = await (async () => {
          hashes ??= await ensureMemoryEmbeddings(
            prisma,
            client,
            userId,
            profile.achievements.map((a) => a.text),
          );
          await ensureOfferEmbeddings(prisma, client, passing);
          return memorySimilarities(
            prisma,
            userId,
            client.provider.embeddingModel,
            passing.map((o) => o.id),
          );
        })().catch((error: unknown) => {
          throw new SemanticUnavailable(error);
        });
        similarities = new Map(
          passing.map((offer) => {
            const sims = byHash.get(offer.id);
            const byAchievement = new Map<string, number>();
            profile.achievements.forEach((a, k) => {
              const sim = sims?.get(hashes![k]!);
              if (sim !== undefined) byAchievement.set(a.id, sim);
            });
            return [offer.id, byAchievement];
          }),
        );
      }

      const titles = new Map(passing.map((o) => [o.id, o.title]));
      const { matches, excluded } = rankOffers(
        profile,
        rails,
        passing,
        similarities,
        deps.config.semanticRange,
        followed,
      );
      excludedCount += excluded.length;
      kept = retain([
        ...kept,
        ...matches.map((match) => ({ match, title: titles.get(match.offerId)! })),
      ]);
    }
    return { kept, passingCount, excludedCount, semantic: semantic && passingCount > 0 };
  };

  let result: Awaited<ReturnType<typeof scan>>;
  const wantsSemantic = deps.client !== null && profile.achievements.length > 0;
  try {
    result = await scan(wantsSemantic);
  } catch (failure) {
    if (!(failure instanceof SemanticUnavailable)) throw failure;
    // Embeddings indisponibles : tout le passage est recalculé sans eux, pour
    // que toutes les offres soient notées de la même façon.
    const error = failure.reason;
    log.warn("matching.embeddings.unavailable", {
      code: isAiError(error) ? error.code : error instanceof Error ? error.name : "erreur",
    });
    result = await scan(false);
  }
  const { kept } = result;

  let stored = 0;
  let unchanged = 0;
  let llm = 0;
  for (const { match, title } of kept) {
    const facts = explanationFacts(match);
    const inputHash = hash({ v: 1, locale, title, score: match.score, facts });
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
      { offerTitle: title, score: match.score, facts, locale },
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
    where: { userId, offerId: { notIn: kept.map((k) => k.match.offerId) } },
  });

  return {
    status: "done",
    offers: total,
    excluded: total - result.passingCount + result.excludedCount,
    stored,
    unchanged,
    removed,
    llm,
    semantic: result.semantic,
  };
}
