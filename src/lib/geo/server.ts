import "server-only";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import type { HttpClient } from "@/lib/radar/http";
import { parseLocationLabel } from "@/lib/radar/normalize";
import { createGeocoder, geoConfig, geoHttpClient, type GeoPoint } from "./index";

/**
 * Géocodage côté application (garde-fous du candidat). Le client HTTP est
 * partagé entre requêtes pour que le débit par hôte (1 req/s vers Nominatim)
 * vaille pour tout le serveur. Les libellés et coordonnées du candidat ne
 * sont jamais journalisés.
 */
const globalForGeo = globalThis as unknown as { geoHttp?: HttpClient | null };

function sharedHttp(): HttpClient | null {
  if (globalForGeo.geoHttp === undefined) {
    try {
      globalForGeo.geoHttp = geoHttpClient(geoConfig());
    } catch {
      globalForGeo.geoHttp = null;
    }
  }
  return globalForGeo.geoHttp;
}

export type LabelLocator = (labels: string[]) => Promise<(GeoPoint | null)[]>;

/**
 * Coordonnées de chaque libellé saisi (« Lyon », « Berlin, Allemagne »), ou
 * `null` si le lieu est introuvable ou le géocodeur indisponible. Ne lève jamais.
 */
export const locateLabels: LabelLocator = async (labels) => {
  const http = sharedHttp();
  const geocoder = http ? createGeocoder(db, geoConfig(), { http, logger }) : null;
  if (!geocoder) return labels.map(() => null);
  const points: (GeoPoint | null)[] = [];
  for (const label of labels) {
    const place = parseLocationLabel(label, ["FR"]);
    const city = place.city ?? label.trim();
    const outcome = await geocoder.geocode({ city, country: place.country });
    points.push(
      outcome.status === "found"
        ? { latitude: outcome.result.latitude, longitude: outcome.result.longitude }
        : null,
    );
  }
  logger.info("geo.guard_rails.located", {
    locations: labels.length,
    located: points.filter(Boolean).length,
  });
  return points;
};
