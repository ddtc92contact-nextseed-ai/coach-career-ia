/**
 * `npm run radar:benchmarks` — recalcule les repères de salaire du marché
 * (famille de métiers × séniorité × zone) à partir des fourchettes publiées
 * dans les offres déjà collectées. Idempotent.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { runSalaryBenchmarks } from "../src/lib/radar/benchmarks/job";

async function main(): Promise<number> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL est requis");
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  try {
    const summary = await runSalaryBenchmarks(prisma);
    console.table([summary]);
    return summary.failed > 0 ? 1 : 0;
  } finally {
    await prisma.$disconnect();
  }
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    console.error("Échec du calcul des repères :", error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
