const DEFAULT_REDIRECT = "/app";

/** En-tête interne posé par `src/proxy.ts` : chemin demandé sous `/app`. */
export const PATHNAME_HEADER = "x-ccia-pathname";

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

/** Page de connexion qui ramène, après connexion, vers `callbackUrl` (validé). */
export function loginPath(callbackUrl: unknown): string {
  return `/connexion?callbackUrl=${encodeURIComponent(safeCallbackUrl(callbackUrl))}`;
}
