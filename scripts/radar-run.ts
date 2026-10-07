/**
 * `npm run radar:run` — un passage du Market Radar sur toutes les sources.
 * Code de sortie 1 si une source a échoué (les autres ont tout de même tourné).
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { radarConfig } from "../src/lib/radar/config";
import { runRadar } from "../src/lib/radar/job";

async function main(): Promise<number> {
  const config = radarConfig();
  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: config.databaseUrl }),
  });
  try {
    const summaries = await runRadar(prisma, config);
    console.table(
      summaries.map((s) => ({
        source: s.sourceKey,
        statut: s.status,
        complet: s.complete,
        reçues: s.fetched,
        créées: s.created,
        modifiées: s.updated,
        fermées: s.closed,
        ignorées: s.skipped,
        doublons: s.duplicates,
        erreur: s.error ?? "",
      })),
    );
    return summaries.some((s) => s.status === "FAILED") ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec du radar :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
