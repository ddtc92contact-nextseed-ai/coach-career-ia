/**
 * `npm run db:seed` — entreprises de référence du radar
 * (`config/radar-companies.json`, idempotent, aussi en production) puis
 * données de démonstration pour le développement (jamais en production).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { loadCompanyConfig, syncCompanies } from "../src/lib/radar/companies";
import { seed } from "./seed-data";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis");

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    // Les candidats peuvent suivre ces entreprises avant le premier passage du radar.
    const file = process.env.RADAR_COMPANIES_FILE || "config/radar-companies.json";
    const reference = await loadCompanyConfig(file);
    const active = await syncCompanies(prisma, reference);
    console.log(
      `Radar : ${reference.length} entreprises de référence importées (${active.length} actives).`,
    );
    if (process.env.NODE_ENV === "production") {
      console.log("Données de démonstration ignorées en production.");
      return;
    }
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
