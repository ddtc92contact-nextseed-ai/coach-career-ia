import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@/generated/prisma/client";
import type { AiClient } from "@/lib/ai/client";

/**
 * Embeddings du matching, stockés avec pgvector (`offer_embeddings`,
 * `memory_embeddings`) et calculés via la couche IA (`AiClient.embed`, par
 * lots). Un texte déjà embarqué avec le même modèle n'est jamais renvoyé au
 * fournisseur : seule son empreinte est comparée. La similarité cosinus est
 * calculée par PostgreSQL (`<=>`).
 */

const OFFER_TEXT_MAX = 2000;
const MEMORY_TEXT_MAX = 1500;
const INSERT_CHUNK = 100;

export const textHash = (text: string) => createHash("sha256").update(text).digest("hex");

export function offerEmbeddingText(offer: { title: string; description: string }): string {
  return `${offer.title}\n${offer.description}`.slice(0, OFFER_TEXT_MAX);
}

export function memoryEmbeddingText(text: string): string {
  return text.slice(0, MEMORY_TEXT_MAX);
}

/** Littéral pgvector : `[0.1,0.2,…]`. */
export function vectorLiteral(vector: number[]): string {
  if (vector.length === 0 || vector.some((v) => !Number.isFinite(v))) {
    throw new Error("Vecteur d'embedding invalide");
  }
  return `[${vector.join(",")}]`;
}

/** Embarque les offres dont le texte (ou le modèle) a changé. Renvoie le nombre embarqué. */
export async function ensureOfferEmbeddings(
  prisma: PrismaClient,
  client: AiClient,
  offers: { id: string; title: string; description: string }[],
): Promise<number> {
  if (offers.length === 0) return 0;
  const model = client.provider.embeddingModel;
  const texts = new Map(offers.map((o) => [o.id, offerEmbeddingText(o)]));
  const existing = await prisma.offerEmbedding.findMany({
    where: { offerId: { in: [...texts.keys()] }, model },
    select: { offerId: true, textHash: true },
  });
  const known = new Map(existing.map((e) => [e.offerId, e.textHash]));
  const missing = [...texts].filter(([id, text]) => known.get(id) !== textHash(text));
  if (missing.length === 0) return 0;

  const vectors = await client.embed(
    missing.map(([, text]) => text),
    { purpose: "matching.offers" },
  );
  for (let i = 0; i < missing.length; i += INSERT_CHUNK) {
    const rows = missing.slice(i, i + INSERT_CHUNK).map(([id, text], j) => {
      const vector = vectorLiteral(vectors[i + j]!);
      return Prisma.sql`(${id}, ${model}, ${textHash(text)}, ${vector}::vector)`;
    });
    await prisma.$executeRaw`
      INSERT INTO offer_embeddings (offer_id, model, text_hash, embedding)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT (offer_id) DO UPDATE
        SET model = EXCLUDED.model, text_hash = EXCLUDED.text_hash,
            embedding = EXCLUDED.embedding, created_at = CURRENT_TIMESTAMP`;
  }
  return missing.length;
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
    const rows = missing.map(
      (m, i) => Prisma.sql`(${userId}, ${model}, ${m.hash}, ${vectorLiteral(vectors[i]!)}::vector)`,
    );
    await prisma.$executeRaw`
      INSERT INTO memory_embeddings (user_id, model, text_hash, embedding)
      VALUES ${Prisma.join(rows)}
      ON CONFLICT (user_id, model, text_hash) DO NOTHING`;
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
