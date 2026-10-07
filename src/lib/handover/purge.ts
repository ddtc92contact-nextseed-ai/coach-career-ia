import type { PrismaClient } from "@/generated/prisma/client";
import type { Logger } from "@/lib/logger";

/**
 * Purge des levées d'anonymat expirées (worker, et à la volée à la lecture) :
 * identité et CV révélés effacés, entrée « expirée » ajoutée au journal du
 * candidat. Utilisable hors de Next.js (client Prisma fourni).
 */

type Db = Pick<PrismaClient, "handover" | "handoverEvent" | "$transaction">;

export async function purgeExpiredHandovers(
  prisma: Db,
  options: { now?: Date; logger?: Logger; where?: { id?: string; contactId?: string } } = {},
): Promise<number> {
  const now = options.now ?? new Date();
  const due = await prisma.handover.findMany({
    where: { purgedAt: null, expiresAt: { lte: now }, ...(options.where ?? {}) },
    select: { id: true, userId: true, contactId: true, fields: true, revokedAt: true },
    take: 500,
  });
  let purged = 0;
  for (const row of due) {
    const done = await prisma.$transaction(async (tx) => {
      const { count } = await tx.handover.updateMany({
        where: { id: row.id, purgedAt: null },
        data: { payloadEnc: null, cvEnc: null, purgedAt: now },
      });
      if (count === 0) return false;
      // Déjà révoquée (purge interrompue) : la révocation est déjà au journal.
      if (!row.revokedAt) {
        await tx.handoverEvent.create({
          data: {
            userId: row.userId,
            contactId: row.contactId,
            handoverId: row.id,
            type: "EXPIRED",
            fields: row.fields,
            createdAt: now,
          },
        });
      }
      return true;
    });
    if (done) purged += 1;
  }
  if (purged > 0) options.logger?.info("handover.purged", { count: purged });
  return purged;
}
