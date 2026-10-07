import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const config = [
  ...nextVitals,
  ...nextTs,
  prettier,
  {
    rules: {
      // Les logs passent par `@/lib/logger`, qui filtre les données personnelles.
      "no-console": "error",
    },
  },
  {
    files: [
      "scripts/**",
      "worker/**",
      "tests/**",
      "prisma/seed.ts",
      "src/lib/logger.ts",
      "src/lib/auth/mailer.ts",
    ],
    rules: { "no-console": "off" },
  },
  {
    ignores: [".next/**", "node_modules/**", "src/generated/**", "next-env.d.ts", "coverage/**"],
  },
];

export default config;
