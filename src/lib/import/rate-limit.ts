/**
 * Limite d'imports par utilisateur sur une fenêtre glissante, en mémoire du
 * processus (une seule instance de l'app derrière Traefik). Protège le coût
 * des appels au modèle.
 */
export function createRateLimiter(options: { max: number; windowMs: number; now?: () => number }) {
  const hits = new Map<string, number[]>();
  const now = options.now ?? Date.now;
  return {
    /** Consomme une unité ; `false` si la limite est atteinte. */
    take(key: string): boolean {
      const since = now() - options.windowMs;
      const recent = (hits.get(key) ?? []).filter((time) => time > since);
      if (recent.length >= options.max) {
        hits.set(key, recent);
        return false;
      }
      recent.push(now());
      hits.set(key, recent);
      return true;
    },
  };
}
