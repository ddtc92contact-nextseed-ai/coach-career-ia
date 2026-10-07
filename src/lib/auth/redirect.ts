const DEFAULT_REDIRECT = "/app";

/** En-tête interne posé par `src/proxy.ts` : chemin demandé sous `/app` ou `/entreprise` (sans la langue). */
export const PATHNAME_HEADER = "x-ccia-pathname";

/**
 * N'accepte comme destination après connexion qu'un chemin interne d'un
 * espace connecté (`/app…` candidat, `/entreprise…` employeur, sans préfixe
 * de langue) : protège contre les redirections ouvertes.
 */
export function safeCallbackUrl(raw: unknown): string {
  if (typeof raw !== "string") return DEFAULT_REDIRECT;
  if (!/^\/(?:app|entreprise)(?:[/?#]|$)/.test(raw)) return DEFAULT_REDIRECT;
  if (raw.includes("\\") || raw.includes("//")) return DEFAULT_REDIRECT;
  return raw;
}

/** Page de connexion (sans langue) qui ramène ensuite vers `callbackUrl` (validé). */
export function loginPath(callbackUrl: unknown): string {
  return `/connexion?callbackUrl=${encodeURIComponent(safeCallbackUrl(callbackUrl))}`;
}
