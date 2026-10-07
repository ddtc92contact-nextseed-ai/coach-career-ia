import "server-only";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { decryptBytes, encryptBytes } from "@/lib/crypto";

/**
 * Stockage privé des pièces justificatives : fichiers chiffrés (AES-256-GCM)
 * sur un volume local (`UPLOAD_DIR`, `./storage/uploads` par défaut), jamais
 * servis statiquement. Arborescence : `<userId>/<uuid>` ; le chiffré est lié
 * à sa clé de stockage (AAD), donc non déplaçable vers un autre utilisateur.
 */

const SAFE_SEGMENT = /^[A-Za-z0-9_-]{1,64}$/;
const KEY_PATTERN = /^([A-Za-z0-9_-]{1,64})\/([0-9a-f-]{36})$/;

export function storageRoot(): string {
  // Chemins dynamiques exclus du traçage des fichiers du build (`turbopackIgnore`).
  return path.resolve(/* turbopackIgnore: true */ process.env.UPLOAD_DIR || "storage/uploads");
}

function userDir(userId: string): string {
  if (!SAFE_SEGMENT.test(userId)) throw new Error("Identifiant utilisateur invalide");
  return path.join(/* turbopackIgnore: true */ storageRoot(), userId);
}

function filePath(storageKey: string): string {
  const match = KEY_PATTERN.exec(storageKey);
  if (!match) throw new Error("Clé de stockage invalide");
  return path.join(/* turbopackIgnore: true */ userDir(match[1]!), match[2]!);
}

const aad = (storageKey: string) => `proof-file:${storageKey}`;

/** Chiffre et enregistre un fichier ; renvoie sa clé de stockage. */
export async function saveDocument(userId: string, bytes: Uint8Array): Promise<string> {
  const storageKey = `${userId}/${randomUUID()}`;
  await mkdir(userDir(userId), { recursive: true, mode: 0o700 });
  await writeFile(filePath(storageKey), encryptBytes(bytes, { aad: aad(storageKey) }), {
    mode: 0o600,
    flag: "wx",
  });
  return storageKey;
}

export async function readDocument(storageKey: string): Promise<Buffer> {
  return decryptBytes(await readFile(filePath(storageKey)), { aad: aad(storageKey) });
}

export async function deleteDocument(storageKey: string): Promise<void> {
  await rm(filePath(storageKey), { force: true });
}

/** Supprime tous les fichiers d'un utilisateur (suppression de compte). */
export async function deleteUserDocuments(userId: string): Promise<void> {
  await rm(userDir(userId), { recursive: true, force: true });
}
