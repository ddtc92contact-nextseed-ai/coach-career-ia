import "server-only";

/**
 * Point d'entrée de l'application (`server-only` : jamais dans le bundle
 * client). Le worker, hors de Next.js, importe directement `./core`.
 */
export * from "./core";
