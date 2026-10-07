import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` lève une erreur hors de Next.js : neutralisé en test.
      "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // next-intl importe `next/server` sans extension (résolu par Next, pas par Node).
    server: { deps: { inline: ["next-intl"] } },
    include: ["tests/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    // Les tests de base partagent une même base : exécution séquentielle des fichiers.
    fileParallelism: false,
  },
});
