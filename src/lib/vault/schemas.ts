import { z } from "zod";
import { KDF_NAME, MAX_KDF_ITERATIONS, MIN_KDF_ITERATIONS, VAULT_VERSION } from "./crypto";

/**
 * Contrat de l'API du coffre (`/api/vault`) : uniquement des blobs opaques
 * en base64. Partagé par les routes (validation) et le client navigateur.
 */

const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

/** Longueur en octets d'une chaîne base64 valide. */
const decodedLength = (value: string) =>
  (value.length / 4) * 3 - (value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0);

/** Enveloppe chiffrée : `[version][iv 12][chiffré + tag 16]`, au moins 29 octets. */
const envelope = (maxBytes: number) =>
  z
    .string()
    .max(Math.ceil(maxBytes / 3) * 4)
    .refine((v) => v.length % 4 === 0 && BASE64.test(v), "base64")
    .refine((v) => decodedLength(v) >= 29 && decodedLength(v) <= maxBytes, "length")
    .refine((v) => {
      const first = v.slice(0, 4);
      return first.length === 4 && atob(first).charCodeAt(0) === VAULT_VERSION;
    }, "version");

export const MAX_IDENTITY_BYTES = 256 * 1024;
/** CV de 5 Mo + en-tête (nom, type) + enveloppe. */
export const MAX_CV_CIPHERTEXT_BYTES = 5 * 1024 * 1024 + 4 * 1024;

export const kdfParams = z.object({
  name: z.literal(KDF_NAME),
  iterations: z.number().int().min(MIN_KDF_ITERATIONS).max(MAX_KDF_ITERATIONS),
  salt: z
    .string()
    .max(64)
    .refine((v) => v.length % 4 === 0 && BASE64.test(v) && decodedLength(v) >= 16, "salt"),
});

/** Clé AES-256 enveloppée : 1 + 12 + 32 + 16 octets. */
const wrappedKey = envelope(61).refine((v) => decodedLength(v) === 61, "length");

export const identityCiphertext = envelope(MAX_IDENTITY_BYTES);

export const createVaultInput = z.object({
  version: z.literal(VAULT_VERSION),
  kdf: kdfParams,
  passphraseWrappedKey: wrappedKey,
  recoveryWrappedKey: wrappedKey,
  identity: identityCiphertext.nullable().default(null),
});

export const updateVaultInput = z
  .object({
    /** Révision connue du client : refus (409) si le coffre a changé entre-temps. */
    revision: z.number().int().min(0),
    identity: identityCiphertext.nullable().optional(),
    /** Nouvelle phrase secrète (changement ou récupération par clé de secours). */
    keys: z.object({ kdf: kdfParams, passphraseWrappedKey: wrappedKey }).optional(),
  })
  .refine((v) => v.identity !== undefined || v.keys !== undefined, "empty");

export type CreateVaultInput = z.infer<typeof createVaultInput>;
export type UpdateVaultInput = z.infer<typeof updateVaultInput>;

/** Réponse de `GET /api/vault`. */
export type VaultResponse = {
  version: number;
  kdf: z.infer<typeof kdfParams>;
  passphraseWrappedKey: string;
  recoveryWrappedKey: string;
  identity: string | null;
  hasCv: boolean;
  revision: number;
};

/** Vérifie qu'un CV chiffré a la forme d'une enveloppe du coffre. */
export function isCvEnvelope(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 29 && bytes.length <= MAX_CV_CIPHERTEXT_BYTES && bytes[0] === VAULT_VERSION
  );
}
