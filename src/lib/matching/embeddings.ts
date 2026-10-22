import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AiClient } from "@/lib/ai/client";
import { estimateTokens } from "@/lib/ai/tokens";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { truncateSafe } from "@/lib/text/truncate";
import type { SimilarityStats } from "./score";

/**
 * Embeddings du matching, stockés avec pgvector (`offer_embeddings`,
 * `memory_embeddings`) et calculés via la couche IA (`AiClient.embed`, par
 * lots). Un texte déjà embarqué avec le même modèle n'est jamais renvoyé au
 * fournisseur : seule son empreinte est comparée. La similarité cosinus est
 * calculée par PostgreSQL (`<=>`).
 *
 * Une offre sans texte exploitable, ou dont le texte est refusé seul par le
 * fournisseur, n'a pas d'embedding : elle est notée sans similarité
 * sémantique, les autres offres gardent la leur (issue #69).
 */

const OFFER_TEXT_MAX = 2000;
const MEMORY_TEXT_MAX = 1500;
const INSERT_CHUNK = 16;
/**
 * Un texte refusé n'est plus renvoyé tant qu'il ne change pas ; il est
 * retenté au bout de ce délai, au cas où le refus ne venait pas de lui.
 */
const REJECTION_RETRY_MS = 7 * 24 * 3_600_000;

export const textHash = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * Titre et début de la description (`OFFER_TEXT_MAX` unités UTF-16 en tout).
 * Seul le début de la description est copié : concaténer puis couper
 * aplatirait la description entière en mémoire (issue #64). La coupe ne
 * sépare jamais les deux moitiés d'un émoji (issue #71).
 */
export function offerEmbeddingText(offer: { title: string; description: string }): string {
  const head = `${offer.title}\n`;
  if (head.length >= OFFER_TEXT_MAX) return truncateSafe(head, OFFER_TEXT_MAX);
  return head + truncateSafe(offer.description, OFFER_TEXT_MAX - head.length);
}

/** Texte embarqué d'une expérience : intitulé et responsabilités (sans l'employeur). */
export function experienceEmbeddingText(experience: {
  title: string;
  responsibilities: string;
}): string {
  return [experience.title, experience.responsibilities]
    .map((part) => part.trim())
    .filter(Boolean)
    .join("\n");
}

export function memoryEmbeddingText(text: string): string {
  return truncateSafe(text, MEMORY_TEXT_MAX);
}

/** Littéral pgvector : `[0.1,0.2,…]`. */
export function vectorLiteral(vector: number[]): string {
  if (vector.length === 0 || vector.some((v) => !Number.isFinite(v))) {
    throw new Error("Vecteur d'embedding invalide");
  }
  return `[${vector.join(",")}]`;
}

/**
 * Embarque les offres dont le texte (ou le modèle) a changé. Renvoie le
 * nombre embarqué. Écarte les offres au texte vide et celles dont ce même
 * texte a déjà été refusé ; mémorise les nouveaux refus (id et taille au
 * journal, jamais le texte).
 */
export async function ensureOfferEmbeddings(
  prisma: PrismaClient,
  client: AiClient,
  offers: { id: string; title: string; description: string }[],
  options: { logger?: Logger; now?: Date } = {},
): Promise<number> {
  if (offers.length === 0) return 0;
  const log = options.logger ?? defaultLogger;
  const model = client.provider.embeddingModel;
  const texts = new Map<string, string>();
  const empty: string[] = [];
  for (const offer of offers) {
    const text = offerEmbeddingText(offer);
    if (text.trim() === "") empty.push(offer.id);
    else texts.set(offer.id, text);
  }
  if (empty.length > 0) {
    // Texte devenu vide : un ancien embedding ne correspondrait plus à l'offre.
    await prisma.offerEmbedding.deleteMany({ where: { offerId: { in: empty } } });
  }
  if (texts.size === 0) return 0;

  const ids = [...texts.keys()];
  const retryBefore = new Date((options.now ?? new Date()).getTime() - REJECTION_RETRY_MS);
  const [existing, rejected] = await Promise.all([
    prisma.offerEmbedding.findMany({
      where: { offerId: { in: ids }, model },
      select: { offerId: true, textHash: true },
    }),
    prisma.offerEmbeddingRejection.findMany({
      where: { offerId: { in: ids }, model, createdAt: { gt: retryBefore } },
      select: { offerId: true, textHash: true },
    }),
  ]);
  const known = new Map(existing.map((e) => [e.offerId, e.textHash]));
  const refused = new Map(rejected.map((r) => [r.offerId, r.textHash]));
  const missing = [...texts]
    .map(([id, text]) => ({ id, text, hash: textHash(text) }))
    .filter(({ id, hash }) => known.get(id) !== hash && refused.get(id) !== hash);
  if (missing.length === 0) return 0;

  const vectors = await client.embed(
    missing.map((m) => m.text),
    { purpose: "matching.offers" },
  );
  const embedded = missing.flatMap((m, i) => (vectors[i] ? [{ ...m, vector: vectors[i] }] : []));
  for (let i = 0; i < embedded.length; i += INSERT_CHUNK) {
    const rows = embedded.slice(i, i + INSERT_CHUNK).map(({ id, hash, vector }) => {
      return Prisma.sql`(${id}, ${model}, ${hash}, ${vectorLiteral(vector)}::vector)`;
    });
    await prisma.$executeRaw`
      INSERT INTO offer_embeddings (offer_id, model, text_hash, embedding)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT (offer_id) DO UPDATE
        SET model = EXCLUDED.model, text_hash = EXCLUDED.text_hash,
            embedding = EXCLUDED.embedding, created_at = CURRENT_TIMESTAMP`;
  }

  for (const { id, text, hash } of missing.filter((_, i) => !vectors[i])) {
    log.warn("matching.embeddings.rejected", {
      offerId: id,
      chars: text.length,
      estTok: estimateTokens(text),
    });
    const data = { model, textHash: hash, createdAt: options.now ?? new Date() };
    await prisma.offerEmbeddingRejection.upsert({
      where: { offerId: id },
      create: { offerId: id, ...data },
      update: data,
    });
  }
  return embedded.length;
}

/**
 * Embarque les éléments de la mémoire du candidat non encore embarqués, et
 * supprime ceux qui n'existent plus (réalisation modifiée ou supprimée).
 * Renvoie l'empreinte de chaque texte, dans l'ordre.
 */
export async function ensureMemoryEmbeddings(
  prisma: PrismaClient,
  client: AiClient,
  userId: string,
  texts: string[],
): Promise<string[]> {
  const model = client.provider.embeddingModel;
  const items = texts.map((t) => {
    const text = memoryEmbeddingText(t);
    return { text, hash: textHash(text) };
  });
  const hashes = [...new Set(items.map((i) => i.hash))];
  const existing = await prisma.memoryEmbedding.findMany({
    where: { userId, model },
    select: { textHash: true },
  });
  const known = new Set(existing.map((e) => e.textHash));
  const missing = [
    ...new Map(items.filter((i) => !known.has(i.hash)).map((i) => [i.hash, i])).values(),
  ];

  if (missing.length > 0) {
    const vectors = await client.embed(
      missing.map((m) => m.text),
      { purpose: "matching.memory" },
    );
    // Texte vide ou refusé (`null`) : pas d'embedding, pas de similarité.
    const rows = missing.flatMap((m, i) => {
      const vector = vectors[i];
      return vector
        ? [Prisma.sql`(${userId}, ${model}, ${m.hash}, ${vectorLiteral(vector)}::vector)`]
        : [];
    });
    if (rows.length > 0) {
      await prisma.$executeRaw`
        INSERT INTO memory_embeddings (user_id, model, text_hash, embedding)
        VALUES ${Prisma.join(rows)}
        ON CONFLICT (user_id, model, text_hash) DO NOTHING`;
    }
  }
  // Ménage : embeddings d'éléments disparus, ou d'un ancien modèle.
  await prisma.memoryEmbedding.deleteMany({
    where: { userId, OR: [{ model: { not: model } }, { textHash: { notIn: hashes } }] },
  });
  return items.map((i) => i.hash);
}

/**
 * Similarité cosinus entre chaque offre et chaque élément de la mémoire :
 * `offerId → (empreinte → similarité)`.
 */
export async function memorySimilarities(
  prisma: PrismaClient,
  userId: string,
  model: string,
  offerIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const result = new Map<string, Map<string, number>>();
  if (offerIds.length === 0) return result;
  const rows = await prisma.$queryRaw<{ offerId: string; textHash: string; similarity: number }[]>`
    SELECT oe.offer_id AS "offerId", me.text_hash AS "textHash",
           (1 - (oe.embedding <=> me.embedding))::float8 AS similarity
    FROM offer_embeddings oe
    JOIN memory_embeddings me ON me.user_id = ${userId} AND me.model = oe.model
    WHERE oe.model = ${model} AND oe.offer_id = ANY(${offerIds}::text[])`;
  for (const row of rows) {
    let byHash = result.get(row.offerId);
    if (!byHash) result.set(row.offerId, (byHash = new Map()));
    byHash.set(row.textHash, Number(row.similarity));
  }
  return result;
}

/**
 * Distribution des similarités de chaque élément de la mémoire du candidat
 * sur ses offres (`offerIds` : offres qui passent le pré-filtre des
 * garde-fous) : `empreinte → { nombre, médiane, 99e centile, maximum }`
 * (le maximum : haut de l'échelle calibrée, issue #77). Calculée
 * entièrement par PostgreSQL : seuls quelques nombres par élément remontent
 * au worker, jamais les offres ni leurs vecteurs (issue #72, mémoire #64).
 * Les offres pas encore embarquées n'y figurent pas.
 */
export async function memorySimilarityStats(
  prisma: PrismaClient,
  userId: string,
  model: string,
  offerIds: string[],
): Promise<Map<string, SimilarityStats>> {
  const result = new Map<string, SimilarityStats>();
  if (offerIds.length === 0) return result;
  const rows = await prisma.$queryRaw<
    {
      textHash: string;
      count: number;
      median: number | null;
      p99: number | null;
      max: number | null;
    }[]
  >`
    SELECT s.text_hash AS "textHash", count(*)::int AS count,
           percentile_cont(0.5) WITHIN GROUP (ORDER BY s.similarity) AS median,
           percentile_cont(0.99) WITHIN GROUP (ORDER BY s.similarity) AS p99,
           max(s.similarity) AS max
    FROM (
      SELECT me.text_hash, (1 - (oe.embedding <=> me.embedding))::float8 AS similarity
      FROM offer_embeddings oe
      JOIN memory_embeddings me ON me.user_id = ${userId} AND me.model = oe.model
      WHERE oe.model = ${model} AND oe.offer_id = ANY(${offerIds}::text[])
    ) s
    GROUP BY s.text_hash`;
  for (const row of rows) {
    if (row.median === null || row.p99 === null) continue;
    result.set(row.textHash, {
      count: Number(row.count),
      median: Number(row.median),
      p99: Number(row.p99),
      max: row.max === null ? Number.NaN : Number(row.max),
    });
  }
  return result;
}
