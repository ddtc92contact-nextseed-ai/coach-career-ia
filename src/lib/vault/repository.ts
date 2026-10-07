import "server-only";
import { db } from "@/lib/db";
import type { CreateVaultInput, UpdateVaultInput, VaultResponse } from "./schemas";

/**
 * Stockage du coffre d'identité. Le serveur ne manipule que des octets
 * opaques : aucune fonction ici ne sait (ni ne peut) déchiffrer.
 * Chaque fonction est filtrée par l'utilisateur courant (`userId`).
 */

const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64");
const bytes = (value: string) => new Uint8Array(Buffer.from(value, "base64"));

const vaultSelect = {
  version: true,
  kdfName: true,
  kdfIterations: true,
  kdfSalt: true,
  passphraseWrappedKey: true,
  recoveryWrappedKey: true,
  identityCiphertext: true,
  revision: true,
} as const;

export async function getVault(userId: string): Promise<VaultResponse | null> {
  const vault = await db.identityVault.findUnique({ where: { userId }, select: vaultSelect });
  if (!vault) return null;
  // Présence du CV sans charger son contenu.
  const withCv = await db.identityVault.count({ where: { userId, cvCiphertext: { not: null } } });
  return {
    version: vault.version,
    kdf: {
      name: vault.kdfName as VaultResponse["kdf"]["name"],
      iterations: vault.kdfIterations,
      salt: b64(vault.kdfSalt),
    },
    passphraseWrappedKey: b64(vault.passphraseWrappedKey),
    recoveryWrappedKey: b64(vault.recoveryWrappedKey),
    identity: vault.identityCiphertext ? b64(vault.identityCiphertext) : null,
    hasCv: withCv > 0,
    revision: vault.revision,
  };
}

/** Crée le coffre ; `false` s'il existe déjà (jamais écrasé). */
export async function createVault(userId: string, input: CreateVaultInput): Promise<boolean> {
  const result = await db.identityVault.createMany({
    data: {
      userId,
      version: input.version,
      kdfName: input.kdf.name,
      kdfIterations: input.kdf.iterations,
      kdfSalt: bytes(input.kdf.salt),
      passphraseWrappedKey: bytes(input.passphraseWrappedKey),
      recoveryWrappedKey: bytes(input.recoveryWrappedKey),
      identityCiphertext: input.identity ? bytes(input.identity) : null,
    },
    skipDuplicates: true,
  });
  return result.count === 1;
}

export type UpdateResult =
  { ok: true; revision: number } | { ok: false; reason: "missing" | "conflict" };

export async function updateVault(userId: string, input: UpdateVaultInput): Promise<UpdateResult> {
  const result = await db.identityVault.updateMany({
    where: { userId, revision: input.revision },
    data: {
      revision: { increment: 1 },
      ...(input.identity !== undefined
        ? { identityCiphertext: input.identity ? bytes(input.identity) : null }
        : {}),
      ...(input.keys
        ? {
            kdfName: input.keys.kdf.name,
            kdfIterations: input.keys.kdf.iterations,
            kdfSalt: bytes(input.keys.kdf.salt),
            passphraseWrappedKey: bytes(input.keys.passphraseWrappedKey),
          }
        : {}),
    },
  });
  if (result.count === 1) return { ok: true, revision: input.revision + 1 };
  const exists = await db.identityVault.count({ where: { userId } });
  return { ok: false, reason: exists ? "conflict" : "missing" };
}

/** Réinitialisation : supprime définitivement le coffre (identité et CV). */
export async function deleteVault(userId: string): Promise<boolean> {
  const result = await db.identityVault.deleteMany({ where: { userId } });
  return result.count === 1;
}

export async function getCv(userId: string): Promise<Uint8Array | null> {
  const vault = await db.identityVault.findUnique({
    where: { userId },
    select: { cvCiphertext: true },
  });
  return vault?.cvCiphertext ?? null;
}

/** Enregistre (ou retire, avec `null`) le CV chiffré ; `false` sans coffre. */
export async function setCv(userId: string, ciphertext: Uint8Array | null): Promise<boolean> {
  const result = await db.identityVault.updateMany({
    where: { userId },
    data: { cvCiphertext: ciphertext ? new Uint8Array(ciphertext) : null },
  });
  return result.count === 1;
}

/** Pour l'export RGPD : les blobs tels que stockés (illisibles sans la phrase). */
export async function exportVault(userId: string, notice: string) {
  const vault = await getVault(userId);
  if (!vault) return null;
  const cv = vault.hasCv ? await getCv(userId) : null;
  return {
    notice,
    ...vault,
    cv: cv ? b64(cv) : null,
  };
}
