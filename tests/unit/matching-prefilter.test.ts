import { describe, expect, it } from "vitest";
import { EARTH_RADIUS_KM, isWithinRadius } from "@/lib/geo/distance";
import { offerEmbeddingText } from "@/lib/matching/embeddings";
import { locationBox } from "@/lib/matching/prefilter";

/** Point à `km` du centre dans la direction `bearing` (degrés), sur la sphère. */
function destination(center: { latitude: number; longitude: number }, km: number, bearing: number) {
  const rad = Math.PI / 180;
  const d = km / EARTH_RADIUS_KM;
  const b = bearing * rad;
  const lat1 = center.latitude * rad;
  const lng1 = center.longitude * rad;
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(b));
  const lng2 =
    lng1 +
    Math.atan2(
      Math.sin(b) * Math.sin(d) * Math.cos(lat1),
      Math.cos(d) - Math.sin(lat1) * Math.sin(lat2),
    );
  // Longitude ramenée dans [-180, 180].
  const lng = ((((lng2 / rad + 180) % 360) + 360) % 360) - 180;
  return { latitude: lat2 / rad, longitude: lng };
}

describe("pré-filtre SQL : zone d'un lieu", () => {
  const centers = [
    { latitude: 48.8566, longitude: 2.3522 }, // Paris
    { latitude: -33.8688, longitude: 151.2093 }, // Sydney
    { latitude: 0.5, longitude: -78.5 }, // équateur
    { latitude: 64.1466, longitude: -21.9426 }, // Reykjavik
    { latitude: 89.5, longitude: 10 }, // près du pôle
    { latitude: 10, longitude: 179.95 }, // antiméridien
  ];
  const radii = [0, 1, 30, 150, 1000, 5000];

  it("contient tout point dans le rayon (bord compris) : le filtre dur n'est jamais plus strict", () => {
    let checked = 0;
    for (const center of centers) {
      for (const radiusKm of radii) {
        const box = locationBox({ ...center, radiusKm })!;
        expect(box).not.toBeNull();
        for (let bearing = 0; bearing < 360; bearing += 7.5) {
          for (const share of [0, 0.25, 0.5, 0.9, 0.999, 1]) {
            const point = destination(center, radiusKm * share, bearing);
            if (!isWithinRadius(point, [{ ...center, radiusKm }])) continue;
            checked++;
            expect(point.latitude).toBeGreaterThanOrEqual(box.minLat);
            expect(point.latitude).toBeLessThanOrEqual(box.maxLat);
            if (box.minLng !== null && box.maxLng !== null) {
              expect(point.longitude).toBeGreaterThanOrEqual(box.minLng);
              expect(point.longitude).toBeLessThanOrEqual(box.maxLng);
            }
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });

  it("reste étroite loin des pôles, sans contrainte de longitude près d'un pôle ou de l'antiméridien", () => {
    const paris = locationBox({ latitude: 48.8566, longitude: 2.3522, radiusKm: 30 })!;
    expect(paris.maxLat - paris.minLat).toBeLessThan(0.6);
    expect(paris.maxLng! - paris.minLng!).toBeLessThan(0.9);
    expect(locationBox({ latitude: 89.5, longitude: 10, radiusKm: 100 })!.minLng).toBeNull();
    expect(locationBox({ latitude: 10, longitude: 179.95, radiusKm: 30 })!.minLng).toBeNull();
  });

  it("aucune zone pour un lieu inutilisable (comme `isWithinRadius`)", () => {
    expect(locationBox({ latitude: null, longitude: 2.35, radiusKm: 30 })).toBeNull();
    expect(locationBox({ latitude: 0, longitude: 0, radiusKm: 30 })).toBeNull();
    expect(locationBox({ latitude: 48.85, longitude: 2.35, radiusKm: -1 })).toBeNull();
    expect(locationBox({ latitude: 48.85, longitude: 2.35, radiusKm: Number.NaN })).toBeNull();
  });
});

describe("texte d'embedding d'une offre", () => {
  it("identique à « titre + description » coupé (empreintes en cache inchangées)", () => {
    const long = "Pipelines de données’ ".repeat(500);
    for (const [title, description] of [
      ["Data Engineer", "Python et SQL."],
      ["Data Engineer", long],
      ["", long],
      ["T".repeat(1999), long],
      ["T".repeat(2000), long],
      ["T".repeat(2500), "court"],
    ] as const) {
      expect(offerEmbeddingText({ title, description })).toBe(
        `${title}\n${description}`.slice(0, 2000),
      );
    }
  });
});
