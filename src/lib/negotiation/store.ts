import "server-only";
import { createHash } from "node:crypto";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * Chiffrement des données de négociation (mandat, messages) : clé de la
 * plateforme, AAD `user:<id>:negotiation`. Rien de ce contenu n'est journalisé.
 */

const aad = (userId: string) => `user:${userId}:negotiation`;

export const encNegotiation = (userId: string, text: string) => encrypt(text, { aad: aad(userId) });
export const decNegotiation = (userId: string, text: string) => decrypt(text, { aad: aad(userId) });

/** Empreinte du texte approuvé : toute modification invalide l'approbation. */
export function messageHash(body: string): string {
  return createHash("sha256").update(`negotiation\0${body}`).digest("base64url");
}
