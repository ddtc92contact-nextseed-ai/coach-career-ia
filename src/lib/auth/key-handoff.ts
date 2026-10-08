import type { AccountKey } from "./account-client";

/**
 * Passage de la clé du coffre, dérivée du mot de passe sur la page de
 * connexion, à l'espace candidat (navigation côté client, même onglet) : la
 * connexion ouvre ainsi le coffre sans second mot de passe.
 *
 * Variable de module, en mémoire uniquement (jamais de stockage navigateur),
 * reprise une seule fois et oubliée après deux minutes. Un rechargement de
 * page l'efface : le coffre redemande alors le mot de passe.
 */

const TTL_MS = 2 * 60_000;
let pending: (AccountKey & { at: number }) | null = null;

export function handOffAccountKey(key: AccountKey): void {
  pending = { ...key, at: Date.now() };
}

export function takeAccountKey(): AccountKey | null {
  const value = pending;
  pending = null;
  if (!value || Date.now() - value.at > TTL_MS) return null;
  return { vaultKey: value.vaultKey, kdf: value.kdf };
}

export function dropAccountKey(): void {
  pending = null;
}
