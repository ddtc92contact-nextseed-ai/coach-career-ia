/**
 * Coffre d'identité « zéro connaissance » : cryptographie côté navigateur.
 *
 * Uniquement WebCrypto (`crypto.subtle`), aucune primitive maison :
 * - clé de données : AES-256-GCM aléatoire, qui chiffre l'identité et le CV ;
 * - clé de phrase secrète : PBKDF2-SHA256 (≥ 600 000 itérations, sel aléatoire)
 *   → clé AES-256-GCM qui « enveloppe » la clé de données ;
 * - clé de secours : 256 bits aléatoires, affichée une seule fois, qui
 *   enveloppe elle aussi la clé de données.
 *
 * Le serveur ne reçoit que des enveloppes opaques (`VaultMaterial`) et des
 * chiffrés. La phrase secrète, la clé de secours et la clé de données ne
 * quittent jamais ce module autrement qu'en mémoire (la clé de données
 * déverrouillée est une `CryptoKey` non exportable).
 *
 * Format binaire d'un chiffré : `[version 1 o][iv 12 o][chiffré + tag 16 o]`.
 * Les données associées (AAD) lient chaque chiffré à son usage : une
 * enveloppe ne peut pas être substituée à une autre (identité ↔ CV ↔ clés).
 *
 * Ce module est isomorphe (navigateur et Node ≥ 20) pour être testé tel quel.
 */

export const VAULT_VERSION = 1;
export const KDF_NAME = "PBKDF2-SHA256";
/** Recommandation OWASP 2023 pour PBKDF2-HMAC-SHA256. */
export const MIN_KDF_ITERATIONS = 600_000;
export const DEFAULT_KDF_ITERATIONS = 600_000;
/** Plafond pour qu'un serveur malveillant ne bloque pas le navigateur. */
export const MAX_KDF_ITERATIONS = 10_000_000;
export const MIN_PASSPHRASE_LENGTH = 12;

const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32;
const HEADER_BYTES = 1 + IV_BYTES;
/** Les tailles des chiffrés d'identité sont arrondies à ce multiple. */
const PADDING_BLOCK = 256;

export type Purpose = "identity" | "cv" | "wrap:passphrase" | "wrap:recovery";

export type KdfParams = { name: typeof KDF_NAME; iterations: number; salt: string };

/** Ce que le serveur stocke : rien de lisible sans phrase secrète ni clé de secours. */
export type VaultMaterial = {
  version: number;
  kdf: KdfParams;
  /** Clé de données enveloppée par la clé dérivée de la phrase secrète (base64). */
  passphraseWrappedKey: string;
  /** Clé de données enveloppée par la clé de secours (base64). */
  recoveryWrappedKey: string;
};

/** Toute erreur de déchiffrement : mauvaise phrase, mauvaise clé ou donnée altérée. */
export class VaultDecryptError extends Error {
  constructor() {
    super("Déchiffrement impossible");
    this.name = "VaultDecryptError";
  }
}

export class VaultParamsError extends Error {
  constructor(message = "Paramètres du coffre invalides") {
    super(message);
    this.name = "VaultParamsError";
  }
}

const subtle = () => globalThis.crypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

const aad = (purpose: Purpose) => encoder.encode(`ccia-vault:v${VAULT_VERSION}:${purpose}`);

function randomBytes(length: number): Uint8Array<ArrayBuffer> {
  return globalThis.crypto.getRandomValues(new Uint8Array(length));
}

// --- Encodages ------------------------------------------------------------------

export function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

export function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new VaultDecryptError();
  }
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** Alphabet base32 de Crockford (sans I, L, O, U : pas de confusion à la saisie). */
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Clé de secours lisible : 52 caractères base32 en groupes de 4. */
export function formatRecoveryKey(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += CROCKFORD[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += CROCKFORD[(value << (5 - bits)) & 31];
  return out.match(/.{1,4}/g)!.join("-");
}

export function parseRecoveryKey(input: string): Uint8Array<ArrayBuffer> {
  const clean = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  const expected = Math.ceil((KEY_BYTES * 8) / 5);
  if (clean.length !== expected) throw new VaultDecryptError();
  const bytes = new Uint8Array(KEY_BYTES);
  let bits = 0;
  let value = 0;
  let index = 0;
  for (const char of clean) {
    const digit = CROCKFORD.indexOf(char);
    if (digit < 0) throw new VaultDecryptError();
    value = ((value << 5) | digit) & 0xffff;
    bits += 5;
    if (bits >= 8 && index < KEY_BYTES) {
      bytes[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  return bytes;
}

// --- Clés ------------------------------------------------------------------------

function checkKdf(kdf: KdfParams): void {
  if (
    kdf.name !== KDF_NAME ||
    !Number.isInteger(kdf.iterations) ||
    kdf.iterations < MIN_KDF_ITERATIONS ||
    kdf.iterations > MAX_KDF_ITERATIONS ||
    fromBase64(kdf.salt).length < SALT_BYTES
  ) {
    throw new VaultParamsError();
  }
}

async function passphraseKey(passphrase: string, kdf: KdfParams): Promise<CryptoKey> {
  checkKdf(kdf);
  const base = await subtle().importKey(
    "raw",
    encoder.encode(passphrase.normalize("NFC")),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return subtle().deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: fromBase64(kdf.salt), iterations: kdf.iterations },
    base,
    { name: "AES-GCM", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

function recoveryWrappingKey(recoveryBytes: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return subtle().importKey("raw", recoveryBytes, { name: "AES-GCM" }, false, [
    "wrapKey",
    "unwrapKey",
  ]);
}

async function wrap(dataKey: CryptoKey, wrappingKey: CryptoKey, purpose: Purpose) {
  const iv = randomBytes(IV_BYTES);
  const wrapped = await subtle().wrapKey("raw", dataKey, wrappingKey, {
    name: "AES-GCM",
    iv,
    additionalData: aad(purpose),
  });
  return toBase64(envelope(iv, new Uint8Array(wrapped)));
}

async function unwrap(
  wrapped: string,
  wrappingKey: CryptoKey,
  purpose: Purpose,
  extractable: boolean,
): Promise<CryptoKey> {
  const { iv, body } = openEnvelope(fromBase64(wrapped));
  try {
    return await subtle().unwrapKey(
      "raw",
      body,
      wrappingKey,
      { name: "AES-GCM", iv, additionalData: aad(purpose) },
      { name: "AES-GCM", length: 256 },
      extractable,
      ["encrypt", "decrypt"],
    );
  } catch {
    throw new VaultDecryptError();
  }
}

function envelope(iv: Uint8Array, body: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(1 + iv.length + body.length);
  out[0] = VAULT_VERSION;
  out.set(iv, 1);
  out.set(body, HEADER_BYTES);
  return out;
}

function openEnvelope(bytes: Uint8Array<ArrayBuffer>) {
  if (bytes.length < HEADER_BYTES + TAG_BYTES || bytes[0] !== VAULT_VERSION) {
    throw new VaultDecryptError();
  }
  return { iv: bytes.slice(1, HEADER_BYTES), body: bytes.slice(HEADER_BYTES) };
}

// --- Cycle de vie du coffre ------------------------------------------------------

export type VaultSetup = {
  material: VaultMaterial;
  /** Clé de données déverrouillée (non exportable), à garder en mémoire seulement. */
  key: CryptoKey;
  /** À montrer une seule fois à l'utilisateur : jamais envoyée au serveur. */
  recoveryKey: string;
};

export async function createVault(
  passphrase: string,
  options: { iterations?: number } = {},
): Promise<VaultSetup> {
  if (passphrase.length < MIN_PASSPHRASE_LENGTH) throw new VaultParamsError("Phrase trop courte");
  const kdf: KdfParams = {
    name: KDF_NAME,
    iterations: options.iterations ?? DEFAULT_KDF_ITERATIONS,
    salt: toBase64(randomBytes(SALT_BYTES)),
  };
  const recoveryBytes = randomBytes(KEY_BYTES);
  // Exportable le temps de l'envelopper, puis rouvert en clé non exportable.
  const exportable = await subtle().generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const passphraseWrappedKey = await wrap(
    exportable,
    await passphraseKey(passphrase, kdf),
    "wrap:passphrase",
  );
  const recoveryKeyCrypto = await recoveryWrappingKey(recoveryBytes);
  const recoveryWrappedKey = await wrap(exportable, recoveryKeyCrypto, "wrap:recovery");
  const key = await unwrap(recoveryWrappedKey, recoveryKeyCrypto, "wrap:recovery", false);
  const recoveryKey = formatRecoveryKey(recoveryBytes);
  recoveryBytes.fill(0);
  return {
    material: { version: VAULT_VERSION, kdf, passphraseWrappedKey, recoveryWrappedKey },
    key,
    recoveryKey,
  };
}

function checkMaterial(material: VaultMaterial): void {
  if (material.version !== VAULT_VERSION) throw new VaultParamsError();
  checkKdf(material.kdf);
}

/** Déverrouille avec la phrase secrète. Lève `VaultDecryptError` si elle est fausse. */
export async function unlockWithPassphrase(
  material: VaultMaterial,
  passphrase: string,
): Promise<CryptoKey> {
  checkMaterial(material);
  const kek = await passphraseKey(passphrase, material.kdf);
  return unwrap(material.passphraseWrappedKey, kek, "wrap:passphrase", false);
}

/** Déverrouille avec la clé de secours. */
export async function unlockWithRecoveryKey(
  material: VaultMaterial,
  recoveryKey: string,
): Promise<CryptoKey> {
  checkMaterial(material);
  const bytes = parseRecoveryKey(recoveryKey);
  const kek = await recoveryWrappingKey(bytes);
  bytes.fill(0);
  return unwrap(material.recoveryWrappedKey, kek, "wrap:recovery", false);
}

async function rewrapWithPassphrase(
  material: VaultMaterial,
  exportable: CryptoKey,
  newPassphrase: string,
  iterations: number,
): Promise<VaultMaterial> {
  if (newPassphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new VaultParamsError("Phrase trop courte");
  }
  const kdf: KdfParams = { name: KDF_NAME, iterations, salt: toBase64(randomBytes(SALT_BYTES)) };
  return {
    ...material,
    kdf,
    passphraseWrappedKey: await wrap(
      exportable,
      await passphraseKey(newPassphrase, kdf),
      "wrap:passphrase",
    ),
  };
}

/**
 * Change la phrase secrète (l'ancienne est requise). La clé de données ne
 * change pas : l'identité et le CV restent lisibles sans rechiffrement.
 */
export async function changePassphrase(
  material: VaultMaterial,
  currentPassphrase: string,
  newPassphrase: string,
): Promise<VaultMaterial> {
  checkMaterial(material);
  const kek = await passphraseKey(currentPassphrase, material.kdf);
  const exportable = await unwrap(material.passphraseWrappedKey, kek, "wrap:passphrase", true);
  return rewrapWithPassphrase(
    material,
    exportable,
    newPassphrase,
    Math.max(material.kdf.iterations, DEFAULT_KDF_ITERATIONS),
  );
}

/** Phrase oubliée : la clé de secours permet d'en définir une nouvelle. */
export async function resetPassphraseWithRecoveryKey(
  material: VaultMaterial,
  recoveryKey: string,
  newPassphrase: string,
): Promise<VaultMaterial> {
  checkMaterial(material);
  const bytes = parseRecoveryKey(recoveryKey);
  const kek = await recoveryWrappingKey(bytes);
  bytes.fill(0);
  const exportable = await unwrap(material.recoveryWrappedKey, kek, "wrap:recovery", true);
  return rewrapWithPassphrase(
    material,
    exportable,
    newPassphrase,
    Math.max(material.kdf.iterations, DEFAULT_KDF_ITERATIONS),
  );
}

// --- Chiffrement des données -----------------------------------------------------

export async function encryptBytes(
  key: CryptoKey,
  plaintext: Uint8Array<ArrayBuffer>,
  purpose: Purpose,
): Promise<Uint8Array<ArrayBuffer>> {
  const iv = randomBytes(IV_BYTES);
  const body = await subtle().encrypt(
    { name: "AES-GCM", iv, additionalData: aad(purpose) },
    key,
    plaintext,
  );
  return envelope(iv, new Uint8Array(body));
}

export async function decryptBytes(
  key: CryptoKey,
  ciphertext: Uint8Array<ArrayBuffer>,
  purpose: Purpose,
): Promise<Uint8Array<ArrayBuffer>> {
  const { iv, body } = openEnvelope(ciphertext);
  try {
    const plain = await subtle().decrypt(
      { name: "AES-GCM", iv, additionalData: aad(purpose) },
      key,
      body,
    );
    return new Uint8Array(plain);
  } catch {
    throw new VaultDecryptError();
  }
}

/**
 * Chiffre une valeur JSON. Le clair est complété par des espaces jusqu'au
 * multiple de 256 octets suivant : la taille du chiffré ne trahit pas la
 * longueur exacte d'un nom.
 */
export async function encryptJson(key: CryptoKey, value: unknown): Promise<string> {
  const json = encoder.encode(JSON.stringify(value));
  const padded = new Uint8Array(Math.ceil((json.length + 1) / PADDING_BLOCK) * PADDING_BLOCK);
  padded.fill(0x20);
  padded.set(json);
  return toBase64(await encryptBytes(key, padded, "identity"));
}

export async function decryptJson(key: CryptoKey, ciphertext: string): Promise<unknown> {
  const plain = await decryptBytes(key, fromBase64(ciphertext), "identity");
  try {
    return JSON.parse(decoder.decode(plain));
  } catch {
    throw new VaultDecryptError();
  }
}

export type VaultFile = { name: string; type: string; bytes: Uint8Array<ArrayBuffer> };

/**
 * Chiffre un fichier avec ses métadonnées (nom d'origine, type) : le serveur
 * ne voit ni le nom ni le type du CV. Format clair :
 * `[longueur de l'en-tête 4 o][en-tête JSON][contenu]`.
 */
export async function encryptFile(
  key: CryptoKey,
  file: VaultFile,
): Promise<Uint8Array<ArrayBuffer>> {
  const header = encoder.encode(JSON.stringify({ name: file.name, type: file.type }));
  const plain = new Uint8Array(4 + header.length + file.bytes.length);
  new DataView(plain.buffer).setUint32(0, header.length);
  plain.set(header, 4);
  plain.set(file.bytes, 4 + header.length);
  return encryptBytes(key, plain, "cv");
}

export async function decryptFile(
  key: CryptoKey,
  ciphertext: Uint8Array<ArrayBuffer>,
): Promise<VaultFile> {
  const plain = await decryptBytes(key, ciphertext, "cv");
  const headerLength = plain.length >= 4 ? new DataView(plain.buffer).getUint32(0) : -1;
  if (headerLength < 0 || 4 + headerLength > plain.length) throw new VaultDecryptError();
  try {
    const header = JSON.parse(decoder.decode(plain.subarray(4, 4 + headerLength))) as {
      name: unknown;
      type: unknown;
    };
    return {
      name: String(header.name),
      type: String(header.type),
      bytes: plain.slice(4 + headerLength),
    };
  } catch {
    throw new VaultDecryptError();
  }
}
