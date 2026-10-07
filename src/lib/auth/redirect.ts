const DEFAULT_REDIRECT = "/app";

/**
 * N'accepte comme destination après connexion qu'un chemin interne de
 * l'espace connecté (`/app…`) : protège contre les redirections ouvertes.
 */
export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_REDIRECT;
  if (!/^\/app(?:[/?#]|$)/.test(raw)) return DEFAULT_REDIRECT;
  if (raw.includes("\\") || raw.includes("//")) return DEFAULT_REDIRECT;
  return raw;
}
