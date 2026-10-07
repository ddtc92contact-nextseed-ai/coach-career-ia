import type { PrismaClient } from "@/generated/prisma/client";
import { logger as defaultLogger, type Logger } from "@/lib/logger";
import { isValidPoint, type GeoPoint } from "./distance";
import type { Geocoder } from "./geocoder";

/** Colonnes de géolocalisation d'une offre. */
export type OfferGeoColumns = {
  latitude: number | null;
  longitude: number | null;
  geocodedAt: Date | null;
};

export type OfferPlace = {
  city: string | null;
  country: string | null;
  postalCode?: string | null;
  cityCode?: string | null;
  /** Coordonnées fournies par la source (France Travail), prioritaires. */
  coordinates?: GeoPoint | null;
};

/**
 * Coordonnées d'une offre : celles de la source si elle en donne, sinon le
 * géocodage de la ville. Seule une ville est géocodée : une région ou un pays
 * seul donnerait un centroïde trompeur pour un filtre « rayon en km ».
 * `geocodedAt` reste `null` si le géocodeur est indisponible (réessai au
 * prochain passage). Ne lève jamais.
 */
export async function locateOffer(
  place: OfferPlace,
  geocoder: Geocoder | null,
  now: Date,
): Promise<OfferGeoColumns> {
  if (isValidPoint(place.coordinates)) {
    return { ...pick(place.coordinates), geocodedAt: now };
  }
  const city = place.city?.trim();
  if (!city) return { latitude: null, longitude: null, geocodedAt: now };
  if (!geocoder) return { latitude: null, longitude: null, geocodedAt: null };
  const outcome = await geocoder.geocode({
    city,
    country: place.country,
    postalCode: place.postalCode ?? null,
    cityCode: place.cityCode ?? null,
  });
  if (outcome.status === "found") return { ...pick(outcome.result), geocodedAt: now };
  return {
    latitude: null,
    longitude: null,
    geocodedAt: outcome.status === "not_found" ? now : null,
  };
}

function pick(p: GeoPoint): GeoPoint {
  return { latitude: p.latitude, longitude: p.longitude };
}

export type BackfillSummary = {
  scanned: number;
  located: number;
  unlocated: number;
  pending: number;
};

/**
 * Rattrapage : géocode les offres ouvertes jamais géocodées (offres
 * antérieures à la fonctionnalité, ou géocodeur indisponible lors de leur
 * collecte). Idempotent ; s'arrête tôt si plus aucun fournisseur ne répond.
 */
export async function backfillOfferCoordinates(
  prisma: PrismaClient,
  geocoder: Geocoder,
  options: { now?: () => Date; logger?: Logger; batchSize?: number; limit?: number } = {},
): Promise<BackfillSummary> {
  const log = options.logger ?? defaultLogger;
  const now = options.now ?? (() => new Date());
  const batchSize = options.batchSize ?? 200;
  const limit = options.limit ?? Number.POSITIVE_INFINITY;
  const summary: BackfillSummary = { scanned: 0, located: 0, unlocated: 0, pending: 0 };
  let cursor: string | undefined;

  while (summary.scanned < limit) {
    const batch = await prisma.jobOffer.findMany({
      where: { status: "OPEN", geocodedAt: null, ...(cursor ? { id: { gt: cursor } } : {}) },
      select: { id: true, city: true, country: true },
      orderBy: { id: "asc" },
      take: Math.min(batchSize, limit - summary.scanned),
    });
    if (batch.length === 0) break;
    for (const offer of batch) {
      summary.scanned++;
      const geo = await locateOffer(offer, geocoder, now());
      if (geo.geocodedAt === null) {
        summary.pending++;
        continue;
      }
      await prisma.jobOffer.update({ where: { id: offer.id }, data: geo });
      if (geo.latitude !== null) summary.located++;
      else summary.unlocated++;
    }
    cursor = batch.at(-1)!.id;
    if (!geocoder.canServe(null)) break;
  }

  log.info("geo.backfill.finished", { ...summary, ...geocoder.stats });
  return summary;
}
