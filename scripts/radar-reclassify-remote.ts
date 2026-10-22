/**
 * `npm run radar:reclassify-remote` — reclasse le télétravail des offres
 * ouvertes dont la mention « full remote » / « hybride » était négative
 * (« pas pour vous si vous recherchez… »), puis demande le recalcul des
 * opportunités de tous les candidats. Idempotent.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { reclassifyRemotePolicies } from "../src/lib/radar/reclassify";

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const summary = await reclassifyRemotePolicies(prisma);
    console.table([
      {
        examinées: summary.scanned,
        reclassées: summary.reclassified,
        "candidats à recalculer": summary.candidates,
      },
    ]);
    return 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec du reclassement :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
