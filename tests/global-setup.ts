import { execFileSync } from "node:child_process";
import "dotenv/config";

/**
 * Stratégie de base de test : une base PostgreSQL + pgvector dédiée
 * (`TEST_DATABASE_URL`, fournie par `docker-compose.dev.yml` en local et par
 * un service en CI), sur laquelle on applique les migrations avant la suite.
 * Aucune remise à zéro destructive : les tests créent des données uniques et
 * restent rejouables.
 * Sans `TEST_DATABASE_URL`, les tests de base sont ignorés (tests unitaires seuls).
 */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) {
    console.warn("TEST_DATABASE_URL absent : tests d'intégration base de données ignorés.");
    return;
  }
  if (url === process.env.DATABASE_URL) {
    throw new Error("TEST_DATABASE_URL doit désigner une base distincte de DATABASE_URL.");
  }
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "inherit",
  });
}
