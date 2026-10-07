/**
 * `npm run radar:signals` — recalcule les signaux faibles des entreprises
 * (pic de recrutement, gel, nouvelle équipe, nouveau lieu, offre republiée,
 * bascule télétravail) à partir des offres déjà collectées. Idempotent.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runCompanySignals } from "../src/lib/radar/signals/job";

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const summary = await runCompanySignals(prisma);
    console.table([summary]);
    return summary.failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec du calcul des signaux :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
