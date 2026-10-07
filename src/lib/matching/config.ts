import { z } from "zod";

/**
 * Réglages du matching, lus depuis l'environnement (aucun secret ici). Le
 * worker les lit au démarrage ; des valeurs par défaut raisonnables
 * s'appliquent si rien n'est fourni.
 */
const bool = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .default(fallback ? "true" : "false")
    .transform((v) => v === "true");
const optional = z.preprocess((v) => (v === "" ? undefined : v), z.string().trim().optional());

const matchingEnvSchema = z.object({
  MATCHING_ENABLED: bool(true),
  /** Intervalle entre deux passages du worker (s). */
  MATCHING_POLL_SECONDS: z.coerce.number().int().min(5).max(3600).default(60),
  /** Délai sans nouveau changement avant de recalculer (s) : regroupe les modifications. */
  MATCHING_DEBOUNCE_SECONDS: z.coerce.number().int().min(0).max(3600).default(30),
  /** Candidats recalculés au plus par passage. */
  MATCHING_USERS_PER_RUN: z.coerce.number().int().min(1).max(1000).default(20),
  /** Score minimal d'une correspondance conservée. */
  MATCHING_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(40),
  /** Nombre maximal de correspondances conservées par candidat. */
  MATCHING_MAX_PER_USER: z.coerce.number().int().min(1).max(2000).default(200),
  /** Résumés formulés par le LLM (sinon : résumés déterministes uniquement). */
  MATCHING_LLM_EXPLANATIONS: bool(true),
  /** Appels LLM au plus par passage du worker (coût) ; au-delà, résumé déterministe. */
  MATCHING_LLM_MAX_PER_RUN: z.coerce.number().int().min(0).max(1000).default(30),
  /** Score minimal pour un résumé formulé par le LLM. */
  MATCHING_LLM_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(55),
  /** Bornes de similarité cosinus des embeddings (dépendent du modèle). */
  MATCHING_SIM_FLOOR: z.coerce.number().min(-1).max(1).default(0.55),
  MATCHING_SIM_CEIL: z.coerce.number().min(-1).max(1).default(0.85),
  /** URL publique de l'application (liens des e-mails) ; à défaut `AUTH_URL`. */
  APP_URL: optional,
  AUTH_URL: optional,
});

export type MatchingConfig = {
  enabled: boolean;
  pollMs: number;
  debounceMs: number;
  usersPerRun: number;
  minScore: number;
  maxPerUser: number;
  llmExplanations: boolean;
  llmMaxPerRun: number;
  llmMinScore: number;
  semanticRange: { floor: number; ceil: number };
  /** `null` : liens impossibles, les alertes e-mail sont désactivées. */
  appUrl: string | null;
};

export function matchingConfig(
  env: Record<string, string | undefined> = process.env,
): MatchingConfig {
  const parsed = matchingEnvSchema.safeParse(env);
  if (!parsed.success) {
    const names = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Configuration du matching invalide : ${names}`);
  }
  const e = parsed.data;
  if (e.MATCHING_SIM_CEIL <= e.MATCHING_SIM_FLOOR) {
    throw new Error("Configuration du matching invalide : MATCHING_SIM_CEIL ≤ MATCHING_SIM_FLOOR");
  }
  const appUrl = [e.APP_URL, e.AUTH_URL].find((url) => url && /^https?:\/\/\S+$/.test(url));
  return {
    enabled: e.MATCHING_ENABLED,
    pollMs: e.MATCHING_POLL_SECONDS * 1000,
    debounceMs: e.MATCHING_DEBOUNCE_SECONDS * 1000,
    usersPerRun: e.MATCHING_USERS_PER_RUN,
    minScore: e.MATCHING_MIN_SCORE,
    maxPerUser: e.MATCHING_MAX_PER_USER,
    llmExplanations: e.MATCHING_LLM_EXPLANATIONS,
    llmMaxPerRun: e.MATCHING_LLM_MAX_PER_RUN,
    llmMinScore: e.MATCHING_LLM_MIN_SCORE,
    semanticRange: { floor: e.MATCHING_SIM_FLOOR, ceil: e.MATCHING_SIM_CEIL },
    appUrl: appUrl ? appUrl.replace(/\/+$/, "") : null,
  };
}
