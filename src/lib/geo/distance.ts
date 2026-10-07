/**
 * Calculs de distance purs (aucune dépendance), exportés pour le matching :
 * le garde-fou de lieu « ville X + rayon N km » est un filtre DUR.
 */

export type GeoPoint = { latitude: number; longitude: number };

/** Point dont les coordonnées peuvent manquer (offre ou lieu non géocodé). */
export type MaybeGeoPoint = { latitude: number | null; longitude: number | null };

export type RadiusLocation = MaybeGeoPoint & { radiusKm: number };

/** Rayon terrestre moyen (UGGI), en km. */
export const EARTH_RADIUS_KM = 6371.0088;

const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Coordonnées utilisables : nombres finis, dans les bornes, et pas (0, 0). */
export function isValidPoint(p: Partial<MaybeGeoPoint> | null | undefined): p is GeoPoint {
  if (!p) return false;
  const { latitude: lat, longitude: lng } = p;
  return (
    typeof lat === "number" &&
    typeof lng === "number" &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180 &&
    !(lat === 0 && lng === 0)
  );
}

/** Distance orthodromique (formule de haversine), en kilomètres. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Vrai si l'offre est à moins de `radiusKm` d'au moins un des lieux acceptés
 * (bord inclus). Purement géographique : une offre ou un lieu sans
 * coordonnées ne correspond jamais (le filtre étant dur, on n'invente pas de
 * position). Le cas « télétravail complet » relève du moteur de matching.
 */
export function isWithinRadius(offer: MaybeGeoPoint, locations: RadiusLocation[]): boolean {
  if (!isValidPoint(offer)) return false;
  return locations.some(
    (location) =>
      isValidPoint(location) &&
      Number.isFinite(location.radiusKm) &&
      location.radiusKm >= 0 &&
      distanceKm(offer, location) <= location.radiusKm,
  );
}
