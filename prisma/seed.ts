/**
 * `npm run db:seed` — données de démonstration pour le développement.
 * Ne fait rien en production.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { seed } from "./seed-data";

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.log("Seed ignoré en production.");
    return;
  }
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    await seed(prisma);
    console.log("Seed terminé : compte de démonstration prêt.");
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("Échec du seed :", error instanceof Error ? error.message : error);
  process.exit(1);
});
