import type { PrismaClient } from "@/generated/prisma/client";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { markAllCandidatesDirty } from "@/lib/matching/jobs";
import { detectRemotePolicy, mentionsRemotePolicy } from "./normalize";

export type ReclassifySummary = { scanned: number; reclassified: number; candidates: number };

/**
 * Rattrapage ponctuel (`npm run radar:reclassify-remote`) : les offres
 * ouvertes classées `FULL_REMOTE` ou `HYBRID` d'après une mention désormais
 * reconnue comme négative (« pas pour vous si vous recherchez un poste 100 %
 * en télétravail ») sont reclassées depuis leur titre et leur description,
 * puis tous les candidats sont recalculés. Idempotent.
 *
 * Une offre dont le texte ne mentionne pas la politique stockée la tient d'un
 * indicateur structuré de l'ATS : elle n'est pas touchée. Les offres
 * reclassées perdent leur empreinte : le passage suivant du radar les réécrit
 * depuis la source (indicateurs structurés compris).
 */
export async function reclassifyRemotePolicies(
  prisma: PrismaClient,
  options: { logger?: Logger; batchSize?: number; now?: Date } = {},
): Promise<ReclassifySummary> {
  const log = options.logger ?? defaultLogger;
  const batchSize = options.batchSize ?? 500;
  const summary: ReclassifySummary = { scanned: 0, reclassified: 0, candidates: 0 };
  let cursor: string | undefined;

  for (;;) {
    const offers = await prisma.jobOffer.findMany({
      where: { status: "OPEN", remotePolicy: { in: ["FULL_REMOTE", "HYBRID"] } },
      select: { id: true, title: true, description: true, remotePolicy: true },
      orderBy: { id: "asc" },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
    });
    if (offers.length === 0) break;
    cursor = offers[offers.length - 1]!.id;
    summary.scanned += offers.length;

    for (const offer of offers) {
      const stored = offer.remotePolicy as "FULL_REMOTE" | "HYBRID";
      const detected = detectRemotePolicy(offer.title, offer.description);
      if (detected === stored || !mentionsRemotePolicy(stored, offer.title, offer.description)) {
        continue;
      }
      await prisma.jobOffer.update({
        where: { id: offer.id },
        data: { remotePolicy: detected, contentHash: "" },
      });
      summary.reclassified++;
    }
  }

  // Toujours, même sans changement : une exécution interrompue avant cette
  // étape est rattrapée en relançant le script.
  summary.candidates = await markAllCandidatesDirty(prisma, options.now);
  log.info("radar.reclassify_remote.finished", { ...summary });
  return summary;
}
