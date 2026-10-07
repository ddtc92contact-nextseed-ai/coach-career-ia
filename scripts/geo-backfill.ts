/**
 * `npm run geo:backfill` — géocode les offres ouvertes encore sans coordonnées
 * (le worker le fait aussi après chaque passage du radar). Idempotent.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { createGeocoder, geoConfig } from "../src/lib/geo";
import { backfillOfferCoordinates } from "../src/lib/geo/offers";

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const geocoder = createGeocoder(prisma, geoConfig());
    if (!geocoder) {
      console.error("Géocodage désactivé (GEO_ENABLED=false ou ni RADAR_CONTACT ni AUTH_URL).");
      return 1;
    }
    const summary = await backfillOfferCoordinates(prisma, geocoder);
    console.table([{ ...summary, ...geocoder.stats }]);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec du rattrapage :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
