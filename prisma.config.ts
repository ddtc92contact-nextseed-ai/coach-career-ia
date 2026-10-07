import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // `prisma generate` n'a pas besoin de base : une valeur vide suffit
    // (CI, build Docker). Les commandes de migration exigent DATABASE_URL.
    url: process.env.DATABASE_URL ?? "",
  },
});
