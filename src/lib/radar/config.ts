import { z } from "zod";
import { geoConfig, type GeoConfig } from "@/lib/geo";

/**
 * Configuration du radar, lue depuis l'environnement (aucun secret dans le
 * dépôt). Volontairement indépendante de `@/lib/env` : le job tourne hors de
 * Next.js (worker, `npm run radar:run`) et n'a pas besoin des secrets d'auth.
 */
const list = (value: string | undefined) =>
  (value ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

const radarEnvSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL est requis"),
  RADAR_CONTACT: z
    .string()
    .trim()
    .min(5, "RADAR_CONTACT (URL ou e-mail de contact du User-Agent) est requis")
    .refine((v) => /^(https?:\/\/|mailto:)?[^\s()]+$/.test(v), "RADAR_CONTACT invalide"),
  RADAR_INTERVAL_HOURS: z.coerce.number().min(0.25).max(168).default(6),
  RADAR_RUN_ON_START: z
    .enum(["true", "false"])
    .default("true")
    .transform((v) => v === "true"),
  RADAR_COUNTRIES: z.string().default("FR"),
  RADAR_COMPANIES_FILE: z.string().default("config/radar-companies.json"),
  RADAR_MIN_INTERVAL_MS: z.coerce.number().int().min(250).default(1000),
  FRANCE_TRAVAIL_CLIENT_ID: z.string().optional(),
  FRANCE_TRAVAIL_CLIENT_SECRET: z.string().optional(),
  RADAR_FT_ROME_CODES: z.string().optional(),
  RADAR_FT_KEYWORDS: z.string().optional(),
  RADAR_FT_DEPARTMENTS: z.string().optional(),
  RADAR_FT_MAX_RESULTS: z.coerce.number().int().min(1).max(3150).default(1050),
});

export type RadarConfig = {
  databaseUrl: string;
  userAgent: string;
  intervalHours: number;
  runOnStart: boolean;
  /** Vide = tous les pays. */
  countries: string[];
  companiesFile: string;
  minIntervalMs: number;
  franceTravail: {
    clientId: string;
    clientSecret: string;
    romeCodes: string[];
    keywords: string | null;
    departments: string[];
    maxResultsPerSearch: number;
  } | null;
  /** Géocodage des offres (`src/lib/geo`). Absent : coordonnées des sources seules. */
  geo?: GeoConfig;
};

export const RADAR_PRODUCT = "CoachCareerIA-Radar/1.0";

export function radarConfig(env: NodeJS.ProcessEnv = process.env): RadarConfig {
  const parsed = radarEnvSchema.safeParse(env);
  if (!parsed.success) {
    // Noms de variables uniquement, jamais leurs valeurs.
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuration du radar invalide : ${names}`);
  }
  const e = parsed.data;
  const countries =
    e.RADAR_COUNTRIES.trim() === "*" ? [] : list(e.RADAR_COUNTRIES).map((c) => c.toUpperCase());
  const hasFt = Boolean(e.FRANCE_TRAVAIL_CLIENT_ID && e.FRANCE_TRAVAIL_CLIENT_SECRET);
  return {
    databaseUrl: e.DATABASE_URL,
    userAgent: `${RADAR_PRODUCT} (+${e.RADAR_CONTACT})`,
    intervalHours: e.RADAR_INTERVAL_HOURS,
    runOnStart: e.RADAR_RUN_ON_START,
    countries,
    companiesFile: e.RADAR_COMPANIES_FILE,
    minIntervalMs: e.RADAR_MIN_INTERVAL_MS,
    franceTravail: hasFt
      ? {
          clientId: e.FRANCE_TRAVAIL_CLIENT_ID!,
          clientSecret: e.FRANCE_TRAVAIL_CLIENT_SECRET!,
          romeCodes: list(e.RADAR_FT_ROME_CODES).map((c) => c.toUpperCase()),
          keywords: e.RADAR_FT_KEYWORDS?.trim() || null,
          departments: list(e.RADAR_FT_DEPARTMENTS),
          maxResultsPerSearch: e.RADAR_FT_MAX_RESULTS,
        }
      : null,
    geo: geoConfig(env),
  };
}
