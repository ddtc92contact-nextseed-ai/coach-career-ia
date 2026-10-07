import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Chiffrement applicatif de champs sensibles (AES-256-GCM).
 *
 * Format chiffré : `v<version>:<iv>:<tag>:<ciphertext>` (base64url), où
 * `version` désigne la clé utilisée. La rotation se fait en ajoutant une
 * nouvelle clé courante et en gardant les anciennes en lecture seule
 * (`DATA_ENCRYPTION_PREVIOUS_KEYS`) le temps de rechiffrer les données
 * (`needsReEncryption`).
 *
 * `aad` (données associées) lie un chiffré à son contexte, par exemple
 * `user:<id>:email` : un chiffré copié vers un autre utilisateur ou un autre
 * champ ne se déchiffre plus.
 */

const ALGORITHM = "aes-256-gcm";
const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const PAYLOAD_PATTERN = /^v(\d+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]+):([A-Za-z0-9_-]*)$/;

export type Keyring = {
  currentVersion: number;
  keys: ReadonlyMap<number, Buffer>;
};

export type CryptoOptions = {
  aad?: string;
  keyring?: Keyring;
};

/** Erreur volontairement générique : aucun détail sur la donnée ni la clé. */
export class DecryptionError extends Error {
  constructor() {
    super("Déchiffrement impossible");
    this.name = "DecryptionError";
  }
}

export class EncryptionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EncryptionConfigError";
  }
}

export function parseKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key.trim(), "base64");
  if (key.length !== KEY_BYTES) {
    throw new EncryptionConfigError(
      `Clé de chiffrement invalide : ${KEY_BYTES} octets encodés en base64 attendus`,
    );
  }
  return key;
}

function parseVersion(raw: string): number {
  const version = Number(raw);
  if (!Number.isInteger(version) || version < 1) {
    throw new EncryptionConfigError("Version de clé invalide : entier ≥ 1 attendu");
  }
  return version;
}

export function createKeyring(input: {
  currentKey: string;
  currentVersion?: number;
  previousKeys?: Record<number, string>;
}): Keyring {
  const currentVersion = input.currentVersion ?? 1;
  parseVersion(String(currentVersion));
  const keys = new Map<number, Buffer>();
  for (const [version, key] of Object.entries(input.previousKeys ?? {})) {
    keys.set(parseVersion(version), parseKey(key));
  }
  keys.set(currentVersion, parseKey(input.currentKey));
  return { currentVersion, keys };
}

/**
 * Lit le trousseau depuis l'environnement :
 * - `DATA_ENCRYPTION_KEY` : clé courante (32 octets en base64, `openssl rand -base64 32`)
 * - `DATA_ENCRYPTION_KEY_VERSION` : sa version (1 par défaut)
 * - `DATA_ENCRYPTION_PREVIOUS_KEYS` : anciennes clés, `1:<base64>,2:<base64>`
 */
export function keyringFromEnv(env: Record<string, string | undefined> = process.env): Keyring {
  const currentKey = env.DATA_ENCRYPTION_KEY;
  if (!currentKey) throw new EncryptionConfigError("DATA_ENCRYPTION_KEY est requis");
  const previousKeys: Record<number, string> = {};
  for (const entry of (env.DATA_ENCRYPTION_PREVIOUS_KEYS ?? "").split(",")) {
    if (!entry.trim()) continue;
    const separator = entry.indexOf(":");
    if (separator < 1) {
      throw new EncryptionConfigError(
        "DATA_ENCRYPTION_PREVIOUS_KEYS : format `version:clé` attendu",
      );
    }
    previousKeys[parseVersion(entry.slice(0, separator).trim())] = entry.slice(separator + 1);
  }
  return createKeyring({
    currentKey,
    currentVersion: env.DATA_ENCRYPTION_KEY_VERSION
      ? parseVersion(env.DATA_ENCRYPTION_KEY_VERSION)
      : 1,
    previousKeys,
  });
}

let envKeyring: Keyring | undefined;

function resolveKeyring(options?: CryptoOptions): Keyring {
  if (options?.keyring) return options.keyring;
  envKeyring ??= keyringFromEnv();
  return envKeyring;
}

// La version de clé fait partie des données authentifiées : on ne peut pas
// la modifier dans le chiffré sans faire échouer le déchiffrement.
function associatedData(version: number, aad?: string): Buffer {
  return Buffer.from(`v${version}|${aad ?? ""}`, "utf8");
}

export function encrypt(plaintext: string, options?: CryptoOptions): string {
  const keyring = resolveKeyring(options);
  const version = keyring.currentVersion;
  const key = keyring.keys.get(version);
  if (!key) throw new EncryptionConfigError("Clé courante absente du trousseau");

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(associatedData(version, options?.aad));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    `v${version}`,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(":");
}

export function decrypt(payload: string, options?: CryptoOptions): string {
  const match = PAYLOAD_PATTERN.exec(payload);
  if (!match) throw new DecryptionError();
  const [, versionRaw = "", ivRaw = "", tagRaw = "", ciphertextRaw = ""] = match;
  const version = Number(versionRaw);
  const key = resolveKeyring(options).keys.get(version);
  if (!key) throw new DecryptionError();

  const iv = Buffer.from(ivRaw, "base64url");
  const tag = Buffer.from(tagRaw, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new DecryptionError();

  try {
    const decipher = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_BYTES });
    decipher.setAAD(associatedData(version, options?.aad));
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextRaw, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new DecryptionError();
  }
}

/** Vrai si le chiffré a été produit avec une clé autre que la clé courante. */
export function needsReEncryption(payload: string, options?: CryptoOptions): boolean {
  const match = PAYLOAD_PATTERN.exec(payload);
  if (!match) throw new DecryptionError();
  return Number(match[1]) !== resolveKeyring(options).currentVersion;
}
